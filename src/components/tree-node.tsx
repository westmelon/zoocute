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
  const children = node.children ?? [];
  const shouldShowChildren = isExpanded && children.length > 0;
  const shouldShowSkeleton = isExpanded && isLoading && children.length === 0;

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
            className={`tree-expand-icon${isExpanded ? " tree-expand-icon--expanded" : ""}${
              isLoading ? " tree-expand-icon--loading" : ""
            }`}
            aria-label={`${isExpanded ? "收起" : "展开"} ${node.name}`}
            onClick={() => onToggle(node.path)}
          >
            <span className="tree-expand-glyph" aria-hidden="true" />
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
      {shouldShowSkeleton ? (
        <ul className="tree-list tree-list--loading" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <li
              key={`${node.path}-loading-${index}`}
              className="tree-loading-row"
              style={{ paddingLeft: `${(depth + 1) * 14 + 26}px` }}
              data-testid="tree-loading-skeleton"
            >
              <span className="tree-loading-bar" />
            </li>
          ))}
        </ul>
      ) : null}
      {shouldShowChildren ? (
        <ul className="tree-list">
          {children.map((child) => (
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
    </li>
  );
}
