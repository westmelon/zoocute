import type { CachedNode, NodeTreeItem, SearchResult } from "./types";

export class PathSearchIndex {
  private byPath = new Map<string, CachedNode>();

  insert(node: CachedNode): void {
    this.byPath.set(node.path, node);
  }

  insertMany(nodes: CachedNode[]): void {
    for (const node of nodes) {
      this.byPath.set(node.path, node);
    }
  }

  /** Remove all direct children of `parentPath`. Used before re-indexing after a refresh. */
  removeChildren(parentPath: string): void {
    for (const [path, node] of this.byPath) {
      if (node.parentPath === parentPath) {
        this.byPath.delete(path);
      }
    }
  }

  /** Remove `path` and all its descendants. Used after a recursive delete. */
  removeSubtree(path: string): void {
    const prefix = path + "/";
    for (const key of this.byPath.keys()) {
      if (key === path || key.startsWith(prefix)) {
        this.byPath.delete(key);
      }
    }
  }

  search(keyword: string): SearchResult[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return [];
    const results: SearchResult[] = [];
    for (const node of this.byPath.values()) {
      if (node.name.toLowerCase().includes(kw)) {
        results.push({ path: node.path, name: node.name, hasChildren: node.hasChildren });
      }
    }
    return results.sort((a, b) => rankResult(a, b, kw));
  }

  patchNodeMeta(path: string, patch: { hasChildren?: boolean }): void {
    const node = this.byPath.get(path);
    if (!node) return;
    this.byPath.set(path, { ...node, ...patch });
  }

  clear(): void {
    this.byPath.clear();
  }
}

function rankResult(a: SearchResult, b: SearchResult, kw: string): number {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  // 1. Exact name match
  if (aName === kw && bName !== kw) return -1;
  if (bName === kw && aName !== kw) return 1;
  // 2. Name prefix match
  const aPrefix = aName.startsWith(kw);
  const bPrefix = bName.startsWith(kw);
  if (aPrefix && !bPrefix) return -1;
  if (bPrefix && !aPrefix) return 1;
  // 3. Shorter path first
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  // 4. Alphabetical
  return a.path.localeCompare(b.path);
}

export function toCachedNode(item: NodeTreeItem, parentPath: string): CachedNode {
  return {
    path: item.path,
    name: item.name,
    parentPath,
    hasChildren: item.hasChildren ?? false,
    hasLoadedChildren: false,
  };
}
