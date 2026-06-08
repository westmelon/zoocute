import { useState, useRef } from "react";
import { PathSearchIndex, toCachedNode } from "../lib/path-search-index";
import type { CachedTreeNode, NodeTreeItem, SearchResult, SearchMode } from "../lib/types";

function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : path.substring(0, lastSlash);
}

export function useNodeSearch(activeTabId: string | null) {
  // One index per session, stored in a ref to avoid re-render on every write.
  const indexes = useRef<Map<string, PathSearchIndex>>(new Map());
  // Per-session search queries — stored in state so changes trigger re-renders.
  const [queryMap, setQueryMap] = useState<Record<string, string>>({});
  const [indexVersion, setIndexVersion] = useState(0);

  function getOrCreate(connectionId: string): PathSearchIndex {
    let idx = indexes.current.get(connectionId);
    if (!idx) {
      idx = new PathSearchIndex();
      indexes.current.set(connectionId, idx);
    }
    return idx;
  }

  /**
   * Replace cached children for `parentPath` and insert `nodes`.
   * Called after every successful `ensureChildrenLoaded`.
   */
  function indexNodes(
    connectionId: string,
    parentPath: string,
    nodes: NodeTreeItem[]
  ): void {
    const idx = getOrCreate(connectionId);
    const nextChildPaths = new Set(nodes.map((node) => node.path));
    for (const childPath of idx.childPaths(parentPath)) {
      if (!nextChildPaths.has(childPath)) {
        idx.removeSubtree(childPath);
      }
    }
    idx.removeChildren(parentPath);
    idx.insertMany(nodes.map((n) => toCachedNode(n, parentPath)));
    setIndexVersion((version) => version + 1);
  }

  /**
   * Remove `path` and all descendants.
   * Called before the parent's force-refresh after a delete.
   */
  function removeSubtree(connectionId: string, path: string): void {
    indexes.current.get(connectionId)?.removeSubtree(path);
    setIndexVersion((version) => version + 1);
  }

  /**
   * Replace the entire index for a session with a flat node list.
   * Used after a full-tree pre-load — clears stale data and rebuilds from scratch.
   */
  function bulkIndex(connectionId: string, nodes: NodeTreeItem[]): void {
    const idx = getOrCreate(connectionId);
    idx.clear();
    for (const node of nodes) {
      const parentPath = getParentPath(node.path);
      idx.insert(toCachedNode(node, parentPath));
    }
    setIndexVersion((version) => version + 1);
  }

  function upsertCachedNodes(connectionId: string, nodes: CachedTreeNode[]): void {
    if (!nodes.length) return;
    getOrCreate(connectionId).upsertCachedNodes(nodes);
    setIndexVersion((version) => version + 1);
  }

  /**
   * Patch metadata for a single cached node (e.g. after a probe reveals hasChildren=true).
   */
  function patchNodeMeta(
    connectionId: string,
    path: string,
    patch: { hasChildren?: boolean }
  ): void {
    indexes.current.get(connectionId)?.patchNodeMeta(path, patch);
    setIndexVersion((version) => version + 1);
  }

  function clearIndex(connectionId: string): void {
    indexes.current.get(connectionId)?.clear();
    setIndexVersion((version) => version + 1);
  }

  function indexSize(connectionId: string): number {
    return indexes.current.get(connectionId)?.size() ?? 0;
  }

  /** Drop all cached data for a session on disconnect. */
  function clearSession(connectionId: string): void {
    indexes.current.get(connectionId)?.clear();
    indexes.current.delete(connectionId);
    setQueryMap((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
    setIndexVersion((version) => version + 1);
  }

  const searchQuery = (activeTabId ? (queryMap[activeTabId] ?? "") : "");
  const searchMode: SearchMode = searchQuery.trim() ? "results" : "tree";
  void indexVersion;
  const searchResults: SearchResult[] =
    searchMode === "results" && activeTabId
      ? (indexes.current.get(activeTabId)?.search(searchQuery) ?? [])
      : [];

  function setSearchQuery(query: string): void {
    if (!activeTabId) return;
    const id = activeTabId;
    setQueryMap((prev) => ({ ...prev, [id]: query }));
  }

  return {
    indexNodes,
    bulkIndex,
    upsertCachedNodes,
    removeSubtree,
    patchNodeMeta,
    clearIndex,
    indexSize,
    clearSession,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchMode,
  };
}
