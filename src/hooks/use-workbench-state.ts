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
import type {
  ActiveSession,
  CacheEvent,
  Charset,
  NodeTreeItem,
  RibbonMode,
  SavedConnection,
  SessionEvent,
  TreeSnapshot,
  WatchEvent,
} from "../lib/types";

/** Returns the ancestor paths that must be expanded to make `path` visible in the tree.
 *  e.g. "/a/b/c" -> ["/a", "/a/b"] */
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
  // Like mergeChildren but does NOT modify hasChildren; patchNodeMeta updates that separately.
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

function pruneExpandedPaths(expandedPaths: Set<string>, targetPath: string): Set<string> {
  const next = new Set<string>();
  for (const path of expandedPaths) {
    if (path === targetPath || path.startsWith(`${targetPath}/`)) continue;
    next.add(path);
  }
  return next;
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

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

function formatConnectionError(error: unknown): string {
  const message = extractErrorMessage(error);
  if (!message) return "\u8fde\u63a5\u5931\u8d25";
  if (message.includes("NoAuth") || message.includes("AuthFailed")) {
    return "\u8ba4\u8bc1\u5931\u8d25\uff1a\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\uff0c\u6216\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u8bbf\u95ee\u6839\u8282\u70b9\u7684\u6743\u9650\u3002\u8bf7\u68c0\u67e5\u7528\u6237\u540d\u3001\u5bc6\u7801\uff0c\u5e76\u786e\u8ba4\u5df2\u4fdd\u5b58\u6700\u65b0\u914d\u7f6e\u3002";
  }
  if (message.includes("Timeout")) {
    return "\u8fde\u63a5\u8d85\u65f6\uff1a\u8bf7\u68c0\u67e5\u8fde\u63a5\u5730\u5740\u548c ZooKeeper \u670d\u52a1\u662f\u5426\u53ef\u8fbe\u3002";
  }
  if (message.includes("empty connect string")) {
    return "\u8fde\u63a5\u5730\u5740\u4e0d\u80fd\u4e3a\u7a7a\u3002";
  }
  return message;
}

type EnsureChildrenResult = {
  children: NodeTreeItem[];
  addedPaths: string[];
};

type ConnectionAction = "connect" | "test";

function treeNodesToSnapshotNodes(
  nodes: NodeTreeItem[],
  parentPath: string | null,
  knownExpandablePaths?: Set<string>
): TreeSnapshot["nodes"] {
  const snapshotNodes: TreeSnapshot["nodes"] = [];
  for (const node of nodes) {
    snapshotNodes.push({
      path: node.path,
      name: node.name,
      parentPath,
      hasChildren: Boolean(node.hasChildren || node.children?.length || knownExpandablePaths?.has(node.path)),
    });
    if (node.children?.length) {
      snapshotNodes.push(...treeNodesToSnapshotNodes(node.children, node.path, knownExpandablePaths));
    }
  }
  return snapshotNodes;
}

function snapshotStatusRank(status: TreeSnapshot["status"]): number {
  switch (status) {
    case "stale":
      return 0;
    case "bootstrapping":
      return 1;
    case "resyncing":
      return 2;
    case "live":
      return 3;
  }
}

function haveSameSnapshotPaths(
  left: TreeSnapshot["nodes"],
  right: TreeSnapshot["nodes"]
): boolean {
  if (left.length !== right.length) return false;
  const leftPaths = new Set(left.map((node) => node.path));
  for (const node of right) {
    if (!leftPaths.has(node.path)) return false;
  }
  return true;
}

function shouldReplaceSnapshot(existing: TreeSnapshot | undefined, next: TreeSnapshot): boolean {
  if (next.nodes.length === 0 && next.status !== "live") {
    return false;
  }
  if (!existing) {
    return next.nodes.length > 0 || next.status === "live";
  }

  const nextRank = snapshotStatusRank(next.status);
  const existingRank = snapshotStatusRank(existing.status);

  if (nextRank > existingRank) return true;
  if (next.nodes.length > existing.nodes.length) return true;
  if (next.nodes.length === existing.nodes.length) {
    return nextRank >= existingRank && !haveSameSnapshotPaths(existing.nodes, next.nodes);
  }
  return false;
}

export function useWorkbenchState(isReadOnly = false) {
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
  const sessionUnlistenRefs = useRef<Map<string, () => void>>(new Map());
  const pendingChildRefreshRefs = useRef<Map<string, Set<string>>>(new Map());
  const cacheSnapshotsRef = useRef<Map<string, TreeSnapshot>>(new Map());
  const reconnectingRefs = useRef<Set<string>>(new Set());

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionAction, setConnectionAction] = useState<ConnectionAction | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  const [indexingConnections, setIndexingConnections] = useState<Set<string>>(new Set());
  const [, setCacheSnapshotVersion] = useState(0);
  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (!connectionError) return;
    const timer = setTimeout(() => {
      setConnectionError((current) => (current === connectionError ? null : current));
    }, 4000);
    return () => clearTimeout(timer);
  }, [connectionError]);

  useEffect(() => {
    if (!connectionNotice) return;
    const timer = setTimeout(() => {
      setConnectionNotice((current) => (current === connectionNotice ? null : current));
    }, 2500);
    return () => clearTimeout(timer);
  }, [connectionNotice]);

  function commitSession(connectionId: string, nextSession: ActiveSession) {
    sessionsRef.current = new Map(sessionsRef.current).set(connectionId, nextSession);
    updateSession(connectionId, () => nextSession);
  }

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
      for (const unlisten of sessionUnlistenRefs.current.values()) {
        unlisten();
      }
      sessionUnlistenRefs.current.clear();
    };
  }, []);

  function syncCacheSnapshot(connectionId: string, treeNodes: NodeTreeItem[]) {
    const existing = cacheSnapshotsRef.current.get(connectionId);
    const knownExpandablePaths = existing
      ? new Set(existing.nodes.filter((node) => node.hasChildren).map((node) => node.path))
      : undefined;
    cacheSnapshotsRef.current.set(connectionId, {
      status: existing?.status ?? "live",
      nodes: treeNodesToSnapshotNodes(treeNodes, "/", knownExpandablePaths),
    });
    setCacheSnapshotVersion((version) => version + 1);
  }

  const handleWatchEvent = useEffectEvent(async (event: WatchEvent) => {
    console.debug("[zk-watch-event] received", event);
    const session = sessionsRef.current.get(event.connectionId);
    if (!session) return;

    if (event.eventType === "children_changed" || event.eventType === "node_created") {
      const pending = pendingChildRefreshRefs.current.get(event.connectionId) ?? new Set<string>();
      if (pending.has(event.path)) return;
      pending.add(event.path);
      pendingChildRefreshRefs.current.set(event.connectionId, pending);
      try {
        await ensureChildrenLoaded(event.connectionId, event.path, { force: true });
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
      const current = sessionsRef.current.get(event.connectionId);
      if (current) {
        const nextTree = removeNode(current.treeNodes, event.path);
        commitSession(event.connectionId, {
          ...current,
          treeNodes: nextTree,
          expandedPaths: pruneExpandedPaths(current.expandedPaths, event.path),
          activePath: current.activePath === event.path ? null : current.activePath,
          activeNode: current.activePath === event.path ? null : current.activeNode,
        });
        syncCacheSnapshot(event.connectionId, nextTree);
      }
      await ensureChildrenLoaded(event.connectionId, getParentPath(event.path), { force: true });
    }
  });

  const openNodeForConnection = useEffectEvent(async (connectionId: string, path: string) => {
    setSaveError(null);

    try {
      const nodeDetails = await getNodeDetails(connectionId, path);
      const currentSession = sessionsRef.current.get(connectionId);
      if (!currentSession) return;
      const nextSession = {
        ...currentSession,
        treeNodes: updateNodeHasChildren(
          currentSession.treeNodes,
          path,
          nodeDetails.childrenCount > 0
        ),
        activePath: path,
        activeNode: nodeDetails,
      };
      commitSession(connectionId, nextSession);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
    }
  });

  async function restoreSessionView(connectionId: string, session: ActiveSession) {
    const expandedPaths = [...session.expandedPaths].sort(
      (left, right) => buildAncestors(left).length - buildAncestors(right).length
    );
    for (const path of expandedPaths) {
      await ensureChildrenLoaded(connectionId, path, { force: true });
    }
    updateSession(connectionId, (current) => ({
      ...current,
      expandedPaths: new Set(session.expandedPaths),
      drafts: session.drafts,
      editingPaths: new Set(session.editingPaths),
    }));
    if (session.activePath) {
      await openNodeForConnection(connectionId, session.activePath);
    }
  }

  async function restartBackgroundIndex(connectionId: string) {
    setIndexingConnections((prev) => new Set([...prev, connectionId]));
    loadFullTreeCmd(connectionId)
      .then((allNodes) => nodeSearch.bulkIndex(connectionId, allNodes))
      .catch(() => { /* partial index is still useful; silently ignore */ })
      .finally(() => {
        setIndexingConnections((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
      });
  }

  const reconnectSession = useEffectEvent(async (connectionId: string) => {
    if (reconnectingRefs.current.has(connectionId)) return;
    const session = sessionsRef.current.get(connectionId);
    if (!session) return;

    reconnectingRefs.current.add(connectionId);
    setConnectionError(null);
    setConnectionNotice("连接已失效，正在重新连接…");
    try {
      await disconnectServerCmd(connectionId).catch(() => {
        // best-effort cleanup before re-establishing a fresh session
      });
      await connectServer(connectionId, {
        connectionString: session.connection.connectionString,
        username: session.connection.username || undefined,
        password: session.connection.password || undefined,
      });
      const rootNodes = await listChildren(connectionId, "/");
      const latestSession = sessionsRef.current.get(connectionId) ?? session;
      const nextSession: ActiveSession = {
        ...latestSession,
        connection: latestSession.connection,
        treeNodes: rootNodes,
        loadingPaths: new Set(),
        activeNode: null,
      };
      commitSession(connectionId, nextSession);
      nodeSearch.clearSession(connectionId);
      nodeSearch.indexNodes(connectionId, "/", rootNodes);
      cacheSnapshotsRef.current.delete(connectionId);
      void cacheTreeSnapshot(connectionId);
      await restoreSessionView(connectionId, latestSession);
      void restartBackgroundIndex(connectionId);
      setConnectionNotice("连接已恢复");
    } catch (error) {
      setConnectionError(formatConnectionError(error));
    } finally {
      reconnectingRefs.current.delete(connectionId);
    }
  });

  const handleSessionEvent = useEffectEvent(async (event: SessionEvent) => {
    const session = sessionsRef.current.get(event.connectionId);
    if (!session) return;

    if (event.eventType === "disconnected") {
      setConnectionError(null);
      setConnectionNotice("连接已中断，等待网络恢复…");
      return;
    }

    if (event.eventType === "connected") {
      if (reconnectingRefs.current.has(event.connectionId)) return;
      setConnectionError(null);
      setConnectionNotice("连接已恢复");
      return;
    }

    if (event.eventType === "expired") {
      await reconnectSession(event.connectionId);
      return;
    }

    if (event.eventType === "auth_failed") {
      setConnectionNotice(null);
      setConnectionError("连接认证失败，请检查用户名和密码。");
      return;
    }

    if (event.eventType === "closed") {
      setConnectionNotice(null);
      setConnectionError("连接已关闭。");
    }
  });

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
          const existing = cacheSnapshotsRef.current.get(connectionId);
          if (shouldReplaceSnapshot(existing, snapshot)) {
            cacheSnapshotsRef.current.set(connectionId, snapshot);
            setCacheSnapshotVersion((version) => version + 1);
          }
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

  async function ensureSessionListener(connectionId: string) {
    if (sessionUnlistenRefs.current.has(connectionId)) return;
    const handler = (event: { payload: SessionEvent }) => {
      if (event.payload.connectionId !== connectionId) return;
      void handleSessionEvent(event.payload);
    };

    const unlisten = await getCurrentWebviewWindow().listen<SessionEvent>(
      "zk-session-event",
      handler
    );
    sessionUnlistenRefs.current.set(connectionId, () => {
      void unlisten();
    });
  }

  async function cacheTreeSnapshot(connectionId: string) {
    try {
      const snapshot = await getTreeSnapshot(connectionId);
      const existing = cacheSnapshotsRef.current.get(connectionId);
      if (shouldReplaceSnapshot(existing, snapshot)) {
        cacheSnapshotsRef.current.set(connectionId, snapshot);
        setCacheSnapshotVersion((version) => version + 1);
      }
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
    setConnectionAction("connect");
    setPendingConnectionId(params.connectionId);
    setConnectionError(null);
    setConnectionNotice(null);
    let connected = false;
    try {
      await connectServer(params.connectionId, {
        connectionString: params.connectionString,
        username: params.username || undefined,
        password: params.password || undefined,
      });
      connected = true;
      const rootNodes = await listChildren(params.connectionId, "/");
      const conn = savedConnections.find((c) => c.id === params.connectionId)!;
      addSession(conn, rootNodes);
      nodeSearch.indexNodes(params.connectionId, "/", rootNodes);
      setRibbonMode("browse");
      await ensureWatchListener(params.connectionId).catch((error) => {
        setConnectionError(
          error instanceof Error ? `watch listener 注册失败: ${error.message}` : "watch listener 注册失败"
        );
      });
      await ensureCacheListener(params.connectionId).catch(() => {
        // cache listener setup is best-effort and must not surface as a user-facing connection error
      });
      await ensureSessionListener(params.connectionId).catch(() => {
        // session listener setup is best-effort and must not block connect flow
      });
      void cacheTreeSnapshot(params.connectionId);

      void restartBackgroundIndex(params.connectionId);
    } catch (error) {
      if (connected) {
        cacheSnapshotsRef.current.delete(params.connectionId);
        pendingChildRefreshRefs.current.delete(params.connectionId);
        try {
          await disconnectServerCmd(params.connectionId);
        } catch {
          // best-effort cleanup after a partially successful connection attempt
        }
      }
      setConnectionError(formatConnectionError(error));
    } finally {
      setIsConnecting(false);
      setConnectionAction(null);
      setPendingConnectionId(null);
    }
  }

  async function testConnection(params: {
    connectionString: string;
    username: string;
    password: string;
    connectionId: string;
  }) {
    setIsConnecting(true);
    setConnectionAction("test");
    setPendingConnectionId(params.connectionId);
    setConnectionError(null);
    setConnectionNotice(null);
    try {
      await connectServer(params.connectionId, {
        connectionString: params.connectionString,
        username: params.username || undefined,
        password: params.password || undefined,
      });
      await listChildren(params.connectionId, "/");
      setConnectionNotice("连接测试成功");
    } catch (error) {
      setConnectionError(formatConnectionError(error));
      return;
    } finally {
      try {
        await disconnectServerCmd(params.connectionId);
      } catch {
        // best-effort cleanup for test-only connections
      }
      setIsConnecting(false);
      setConnectionAction(null);
      setPendingConnectionId(null);
    }
  }

  function showConnectionNotice(message: string) {
    setConnectionError(null);
    setConnectionNotice(message);
  }

  function showConnectionError(message: string) {
    setConnectionNotice(null);
    setConnectionError(message);
  }

  async function disconnectSession(connectionId: string) {
    unlistenRefs.current.get(connectionId)?.();
    unlistenRefs.current.delete(connectionId);
    cacheUnlistenRefs.current.get(connectionId)?.();
    cacheUnlistenRefs.current.delete(connectionId);
    sessionUnlistenRefs.current.get(connectionId)?.();
    sessionUnlistenRefs.current.delete(connectionId);
    cacheSnapshotsRef.current.delete(connectionId);
    pendingChildRefreshRefs.current.delete(connectionId);
    reconnectingRefs.current.delete(connectionId);
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
    const session = sessionsRef.current.get(connectionId);
    if (!session) return undefined;
    if (path !== "/") {
      const targetNode = findNode(session.treeNodes, path);
      if (!targetNode) return undefined;
      if (!options?.force && !targetNode.hasChildren) return undefined;
      if (!options?.force && targetNode.children) return undefined;
    }

    // Snapshot current children BEFORE the await; used for addedPaths diff
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
      const current = sessionsRef.current.get(connectionId);
      if (!current) return undefined;
      const knownExpandablePaths = new Set(
        (cacheSnapshotsRef.current.get(connectionId)?.nodes ?? [])
          .filter((node) => node.hasChildren)
          .map((node) => node.path)
      );
      const normalizedChildren = children.map((child) =>
        child.hasChildren || !knownExpandablePaths.has(child.path)
          ? child
          : { ...child, hasChildren: true }
      );
      const newTree = replaceChildren(current.treeNodes, path, normalizedChildren);
      const patchedTree =
        path === "/"
          ? newTree
          : patchNodeMeta(newTree, path, { hasChildren: normalizedChildren.length > 0 });
      commitSession(connectionId, {
        ...current,
        treeNodes: patchedTree,
        loadingPaths: (() => {
          const next = new Set(current.loadingPaths);
          next.delete(path);
          return next;
        })(),
      });
      syncCacheSnapshot(connectionId, patchedTree);
      nodeSearch.indexNodes(connectionId, path, normalizedChildren);

      const addedPaths = normalizedChildren
        .filter((c) => !prevPaths.has(c.path))
        .map((c) => c.path);

      return { children: normalizedChildren, addedPaths };
    } catch (error) {
      const isDeletedDuringRefresh = options?.force && path !== "/" && isNoNodeError(error);
      updateSession(connectionId, (s) => ({
        ...s,
        treeNodes: isDeletedDuringRefresh ? removeNode(s.treeNodes, path) : s.treeNodes,
        expandedPaths: isDeletedDuringRefresh ? pruneExpandedPaths(s.expandedPaths, path) : s.expandedPaths,
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
    await openNodeForConnection(activeTabId, path);
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
    const session = sessionsRef.current.get(activeTabId);
    if (!session) return;
    const isExpanded = session.expandedPaths.has(path);

    if (isExpanded) {
      const next = new Set(session.expandedPaths);
      next.delete(path);
      commitSession(activeTabId, { ...session, expandedPaths: next });
      return;
    }

    commitSession(activeTabId, {
      ...session,
      expandedPaths: new Set(session.expandedPaths).add(path),
    });
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

  async function handleSave(path: string, value: string, charset: Charset) {
    if (!activeTabId) return;
    if (isReadOnly) {
      setSaveError("当前为只读模式，禁止新增、修改、删除节点。");
      return;
    }
    setSaveError(null);
    try {
      await saveNode(activeTabId, path, value, charset);
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
    if (isReadOnly) {
      setConnectionError("当前为只读模式，禁止新增、修改、删除节点。");
      return;
    }
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
    if (isReadOnly) {
      setConnectionError("当前为只读模式，禁止新增、修改、删除节点。");
      return;
    }
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
    // being flushed between each await; sessions is a stale closure.
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
        // best-effort; continue even if one level fails
      }
    }

    // Apply all tree changes + expand ancestors in one batch
    updateSession(connId, (s) => ({
      ...s,
      treeNodes: workingNodes,
      expandedPaths: new Set([...s.expandedPaths, ...ancestors]),
    }));
    syncCacheSnapshot(connId, workingNodes);

    nodeSearch.setSearchQuery("");
    await doOpenNode(path);
  }

  // Derive current session's state for App.tsx consumption
  const cachedSnapshot = activeTabId ? cacheSnapshotsRef.current.get(activeTabId) ?? null : null;
  const treeNodes = cachedSnapshot
    ? buildProjectedTree(cachedSnapshot, activeSession?.expandedPaths ?? new Set<string>())
    : activeSession?.treeNodes ?? [];
  const expandedPaths = activeSession?.expandedPaths ?? new Set<string>();
  const loadingPaths = activeSession?.loadingPaths ?? new Set<string>();
  const activePath = activeSession?.activePath ?? null;
  const activeNode = activeSession?.activeNode ?? null;
  const drafts = activeSession?.drafts ?? {};
  const draft = activePath ? drafts[activePath] : undefined;
  const editingPaths = activeSession?.editingPaths ?? new Set<string>();
  const isEditing = activePath ? editingPaths.has(activePath) : false;
  const cacheStatus = activeTabId
    ? cacheSnapshotsRef.current.get(activeTabId)?.status ?? "stale"
    : "stale";

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
    connectionAction,
    pendingConnectionId,
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
    showConnectionError,
    searchQuery: nodeSearch.searchQuery,
    setSearchQuery: nodeSearch.setSearchQuery,
    searchResults: nodeSearch.searchResults,
    searchMode: nodeSearch.searchMode,
    isIndexing: activeTabId ? indexingConnections.has(activeTabId) : false,
    cacheStatus,
    locate,
  };
}
