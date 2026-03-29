import { useState, useEffect } from "react";
import { usePersistedConnections } from "./use-persisted-connections";
import { useSessionManager } from "./use-session-manager";
import { useNodeSearch } from "./use-node-search";
import {
  connectServer,
  disconnectServer as disconnectServerCmd,
  createNode as createNodeCmd,
  deleteNode as deleteNodeCmd,
  getNodeDetails,
  listChildren,
  loadFullTree as loadFullTreeCmd,
  saveNode,
} from "../lib/commands";
import type { NodeTreeItem, RibbonMode } from "../lib/types";

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
    enterEditMode: enterEditModeSession,
    exitEditMode: exitEditModeSession,
  } = useSessionManager();

  const nodeSearch = useNodeSearch(activeTabId);

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  const [indexingConnections, setIndexingConnections] = useState<Set<string>>(new Set());

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
      nodeSearch.indexNodes(params.connectionId, "/", rootNodes);
      setRibbonMode("browse");

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

  async function disconnectSession(connectionId: string) {
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
      nodeSearch.indexNodes(connectionId, path, children);
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
      updateSession(activeTabId, (s) => ({
        ...s,
        activePath: path,
        activeNode: nodeDetails,
      }));
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
      const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
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
  const treeNodes = activeSession?.treeNodes ?? [];
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
    saveError,
    isConnecting,
    pendingNavPath,
    openNode,
    confirmNavAndDiscard,
    cancelPendingNav,
    toggleNode,
    refreshActiveNode,
    ensureChildrenLoaded: (path: string, opts?: { force?: boolean }) =>
      activeTabId ? ensureChildrenLoaded(activeTabId, path, opts) : Promise.resolve(),
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
    disconnectSession,
    searchQuery: nodeSearch.searchQuery,
    setSearchQuery: nodeSearch.setSearchQuery,
    searchResults: nodeSearch.searchResults,
    searchMode: nodeSearch.searchMode,
    isIndexing: activeTabId ? indexingConnections.has(activeTabId) : false,
    locate,
  };
}
