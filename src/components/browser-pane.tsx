import { useEffect, useRef } from "react";
import type { NodeTreeItem, SearchResult, SearchMode } from "../lib/types";
import { TreeNode } from "./tree-node";
import { ScrollArea } from "./scroll-area";

interface BrowserPaneProps {
  treeNodes: NodeTreeItem[];
  activePath: string | null;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  connectionString: string;
  isConnected: boolean;
  onSelectPath: (path: string) => void;
  onTogglePath: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
  // Search
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchResults: SearchResult[];
  searchMode: SearchMode;
  onLocate: (path: string) => void;
  isIndexing: boolean;
}

export function BrowserPane({
  treeNodes, activePath, expandedPaths, loadingPaths,
  connectionString, isConnected,
  onSelectPath, onTogglePath, onContextMenu,
  searchQuery, onSearchQueryChange, searchResults, searchMode, onLocate, isIndexing,
}: BrowserPaneProps) {
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activePath || searchMode !== "tree") return;
    const id = setTimeout(() => {
      treeRef.current
        ?.querySelector<HTMLElement>(".tree-node-row.active")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(id);
  }, [activePath, searchMode]);

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">节点树</span>
      </div>
      <div className="conn-badge">
        <span className={`conn-dot${isConnected ? " conn-dot--connected" : ""}`} />
        <span>{connectionString || "未连接"}</span>
      </div>
      <input
        className="panel-search"
        placeholder="搜索节点..."
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
      />
      {isIndexing && (
        <div className="search-indexing-hint">正在建立搜索索引…</div>
      )}

      {searchMode === "results" ? (
        <SearchResultList
          results={searchResults}
          keyword={searchQuery}
          onLocate={onLocate}
        />
      ) : (
        <div ref={treeRef} style={{ display: "contents" }}>
          <ScrollArea className="tree-scroll">
            {treeNodes.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                activePath={activePath}
                depth={0}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                onSelect={onSelectPath}
                onToggle={onTogglePath}
                onContextMenu={onContextMenu}
              />
            ))}
          </ScrollArea>
        </div>
      )}
    </>
  );
}

// ─── Search result list ──────────────────────────────────────────────────────

function SearchResultList({
  results, keyword, onLocate,
}: {
  results: SearchResult[];
  keyword: string;
  onLocate: (path: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="search-empty">
        <div>未找到匹配的已缓存节点</div>
        <div className="search-empty-hint">仅搜索本次会话已加载的节点</div>
      </div>
    );
  }

  return (
    <ScrollArea className="tree-scroll">
      {results.map((r) => (
        <button
          key={r.path}
          className="search-result-item"
          onClick={() => onLocate(r.path)}
        >
          <div className="search-result-name">
            <HighlightMatch text={r.name} keyword={keyword} />
          </div>
          <div className="search-result-path">{r.path}</div>
        </button>
      ))}
    </ScrollArea>
  );
}

function HighlightMatch({ text, keyword }: { text: string; keyword: string }) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  );
}
