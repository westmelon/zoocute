import type { NodeTreeItem } from "../lib/types";

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

export function TreeNode({
  node,
  activePath,
  depth,
  onSelect,
  expandedPaths,
  loadingPaths,
  onToggle,
  onContextMenu,
}: TreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const canExpand = Boolean(node.hasChildren || node.children?.length);

  return (
    <li>
      <div
        className={`tree-node-row${activePath === node.path ? " active" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(node.path, e);
        }}
      >
        {canExpand ? (
          <button
            type="button"
            className="tree-expand-icon"
            aria-label={`${isExpanded ? "收起" : "展开"} ${node.name}`}
            onClick={() => onToggle(node.path)}
          >
            {isLoading ? "…" : isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="tree-expand-icon" aria-hidden="true" />
        )}
        <button
          type="button"
          className="tree-node-label"
          onClick={() => onSelect(node.path)}
        >
          {node.name}
        </button>
      </div>
      {isLoading ? <p className="tree-status">加载中...</p> : null}
      {isExpanded && node.children?.length ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              activePath={activePath}
              depth={depth + 1}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      ) : null}
      {isExpanded && !isLoading && !node.children?.length && !node.hasChildren ? (
        <p className="tree-status tree-status--empty">暂无子节点</p>
      ) : null}
    </li>
  );
}
