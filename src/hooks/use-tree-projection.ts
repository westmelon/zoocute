import type { NodeTreeItem, TreeSnapshot } from "../lib/types";

const ROOT_PARENT = "__root__";

function parentKey(parentPath: string | null | undefined): string {
  return parentPath == null || parentPath === "/" ? ROOT_PARENT : parentPath;
}

export function buildProjectedTree(
  snapshot: TreeSnapshot | null,
  expandedPaths: Set<string>
): NodeTreeItem[] {
  if (!snapshot) return [];

  const childrenByParent = new Map<string, TreeSnapshot["nodes"]>();
  for (const node of snapshot.nodes) {
    const key = parentKey(node.parentPath);
    const children = childrenByParent.get(key) ?? [];
    children.push(node);
    childrenByParent.set(key, children);
  }

  const projectLevel = (parentPath: string | null): NodeTreeItem[] => {
    const nodes = childrenByParent.get(parentKey(parentPath)) ?? [];
    return nodes.map((node) => ({
      path: node.path,
      name: node.name,
      hasChildren: node.hasChildren,
      children: expandedPaths.has(node.path) ? projectLevel(node.path) : undefined,
    }));
  };

  const roots = childrenByParent.get(ROOT_PARENT) ?? [];
  return roots.map((node) => ({
    path: node.path,
    name: node.name,
    hasChildren: node.hasChildren,
    children: expandedPaths.has(node.path) ? projectLevel(node.path) : undefined,
  }));
}
