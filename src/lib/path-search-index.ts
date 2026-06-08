import type { CachedNode, CachedTreeNode, NodeTreeItem, SearchResult } from "./types";

export class PathSearchIndex {
  private byPath = new Map<string, CachedNode>();
  private childrenByParent = new Map<string, Set<string>>();

  insert(node: CachedNode): void {
    this.removeFromParentIndex(node.path);
    this.byPath.set(node.path, node);
    this.addToParentIndex(node);
  }

  insertMany(nodes: CachedNode[]): void {
    for (const node of nodes) {
      this.insert(node);
    }
  }

  upsertCachedNodes(nodes: CachedTreeNode[]): void {
    for (const node of nodes) {
      this.insert(toCachedNodeFromSnapshot(node));
    }
  }

  childPaths(parentPath: string): string[] {
    return [...(this.childrenByParent.get(parentPath) ?? [])];
  }

  /** Remove all direct children of `parentPath`. Used before re-indexing after a refresh. */
  removeChildren(parentPath: string): void {
    for (const path of this.childPaths(parentPath)) {
      this.removeSubtree(path);
    }
    this.childrenByParent.delete(parentPath);
  }

  /** Remove `path` and all its descendants. Used after a recursive delete. */
  removeSubtree(path: string): void {
    const prefix = path + "/";
    for (const key of this.byPath.keys()) {
      if (key === path || key.startsWith(prefix)) {
        this.deleteNode(key);
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
    this.childrenByParent.clear();
  }

  size(): number {
    return this.byPath.size;
  }

  private deleteNode(path: string): void {
    this.removeFromParentIndex(path);
    this.childrenByParent.delete(path);
    this.byPath.delete(path);
  }

  private addToParentIndex(node: CachedNode): void {
    if (!node.parentPath) return;
    const siblings = this.childrenByParent.get(node.parentPath) ?? new Set<string>();
    siblings.add(node.path);
    this.childrenByParent.set(node.parentPath, siblings);
  }

  private removeFromParentIndex(path: string): void {
    const existing = this.byPath.get(path);
    if (!existing?.parentPath) return;
    const siblings = this.childrenByParent.get(existing.parentPath);
    if (!siblings) return;
    siblings.delete(path);
    if (siblings.size === 0) {
      this.childrenByParent.delete(existing.parentPath);
    }
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

export function toCachedNodeFromSnapshot(item: CachedTreeNode): CachedNode {
  return {
    path: item.path,
    name: item.name,
    parentPath: item.parentPath,
    hasChildren: item.hasChildren,
    hasLoadedChildren: false,
  };
}
