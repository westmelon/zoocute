import "./styles/app.css";
import "overlayscrollbars/overlayscrollbars.css";
import { useState } from "react";
import { usePanelResize } from "./hooks/use-panel-resize";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { Ribbon } from "./components/ribbon";
import { BrowserPane } from "./components/browser-pane";
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";
import { EditorPanel } from "./components/editor-panel";
import { TreeContextMenu } from "./components/tree-context-menu";
import { ServerTabs } from "./components/server-tabs";
import { LogFilterPane, LogListPane } from "./components/log-pane";
import { useLogState } from "./hooks/use-log-state";

export default function App() {
  const {
    ribbonMode, setRibbonMode,
    hasActiveSessions,
    sessions, activeTabId, setActiveTabId,
    activeSession,
    activePath, activeNode,
    drafts,
    treeNodes, expandedPaths, loadingPaths,
    connectionError,
    saveError,
    openNode, toggleNode, ensureChildrenLoaded,
    pendingNavPath, confirmNavAndDiscard, cancelPendingNav,
    updateDraft, discardDraft, handleSave,
    isEditing,
    enterEditMode,
    exitEditMode,
    fetchServerValue,
    createNode, deleteNode,
    submitConnection, disconnectSession,
    savedConnections, setSavedConnections,
    selectedConnectionId, setSelectedConnectionId,
    searchQuery, setSearchQuery, searchResults, searchMode, locate, isIndexing,
  } = useWorkbenchState();

  const { width: sidebarWidth, onMouseDown: onResizeMouseDown } = usePanelResize(
    220, "zoocute:sidebar-width"
  );

  const logState = useLogState(ribbonMode === "log");

  const draft = activePath ? drafts[activePath] : undefined;

  const selectedConn =
    savedConnections.find((c) => c.id === selectedConnectionId) ?? savedConnections[0];

  const [contextMenu, setContextMenu] = useState<{
    path: string; x: number; y: number; hasChildren: boolean;
  } | null>(null);

  const showTabs = ribbonMode === "browse" && hasActiveSessions;

  return (
    <div className="app-shell">
      <Ribbon
        mode={ribbonMode}
        onModeChange={setRibbonMode}
        hasActiveSessions={hasActiveSessions}
      />
      {connectionError && (
        <div className="error-toast">{connectionError}</div>
      )}

      <div className="left-panel" style={{ width: sidebarWidth }}>
        {ribbonMode === "browse" && activeSession && (
          <BrowserPane
            treeNodes={treeNodes}
            activePath={activePath}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
            connectionString={activeSession.connection.connectionString}
            isConnected={true}
            onSelectPath={openNode}
            onTogglePath={toggleNode}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={searchResults}
            searchMode={searchMode}
            onLocate={locate}
            isIndexing={isIndexing}
            onContextMenu={(path, e) => {
              const node = treeNodes
                .flatMap(function flatten(n): typeof treeNodes {
                  return [n, ...(n.children ?? []).flatMap(flatten)];
                })
                .find((n) => n.path === path);
              setContextMenu({ path, x: e.clientX, y: e.clientY, hasChildren: !!(node?.hasChildren) });
            }}
          />
        )}
        {ribbonMode === "connections" && (
          <ConnectionPane
            connections={savedConnections}
            selectedId={selectedConnectionId}
            connectedId={activeTabId}
            onSelect={setSelectedConnectionId}
            onNew={() => {
              const newConn = {
                id: Date.now().toString(),
                name: "新连接",
                connectionString: "",
                timeoutMs: 5000,
              };
              setSavedConnections((prev) => [...prev, newConn]);
              setSelectedConnectionId(newConn.id);
            }}
            onConnect={(c) =>
              submitConnection({
                connectionString: c.connectionString,
                username: c.username ?? "",
                password: c.password ?? "",
                connectionId: c.id,
              })
            }
            onDisconnect={disconnectSession}
          />
        )}
        {ribbonMode === "log" && (
          <LogFilterPane
            filters={logState.filters}
            onFiltersChange={logState.setFilters}
            loading={logState.loading}
            onRefresh={logState.refresh}
            onClear={logState.clear}
            connections={savedConnections.map((c) => ({ id: c.id, name: c.name }))}
          />
        )}
      </div>

      <div className="resize-handle" onMouseDown={onResizeMouseDown} />

      <div className="content-area">
        {showTabs && (
          <ServerTabs
            sessions={sessions}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
            onTabClose={disconnectSession}
          />
        )}

        {ribbonMode === "browse" && activeSession && activeNode && (
          <EditorPanel
            key={activePath ?? ""}
            node={activeNode}
            draft={draft}
            saveError={saveError}
            isEditing={isEditing}
            onEnterEdit={() => activePath && enterEditMode(activePath)}
            onExitEdit={() => activePath && exitEditMode(activePath)}
            onDraftChange={(v) => activePath && updateDraft(activePath, v)}
            onSave={(v) => activePath && handleSave(activePath, v)}
            onDiscard={() => activePath && discardDraft(activePath)}
            onFetchServerValue={() => activePath ? fetchServerValue(activePath) : Promise.resolve(null)}
            pendingNavPath={pendingNavPath}
            onConfirmNavAndDiscard={confirmNavAndDiscard}
            onCancelPendingNav={cancelPendingNav}
          />
        )}

        {ribbonMode === "browse" && activeSession && !activeNode && (
          <div className="placeholder-pane">选择左侧节点查看详情</div>
        )}

        {ribbonMode === "connections" && selectedConn && (
          <ConnectionDetail
            connection={selectedConn}
            isConnected={sessions.has(selectedConn.id)}
            onSave={(c) =>
              setSavedConnections((prev) => prev.map((x) => (x.id === c.id ? c : x)))
            }
            onTestConnect={(c) =>
              submitConnection({
                connectionString: c.connectionString,
                username: c.username ?? "",
                password: c.password ?? "",
                connectionId: c.id,
              })
            }
            onDelete={(id) => {
              setSavedConnections((prev) => prev.filter((x) => x.id !== id));
              setSelectedConnectionId(
                savedConnections.find((x) => x.id !== id)?.id ?? null
              );
            }}
          />
        )}

        {ribbonMode === "log" && (
          <LogListPane
            entries={logState.entries}
            loading={logState.loading}
            error={logState.error}
            onRefresh={logState.refresh}
          />
        )}
      </div>

      {contextMenu && (
        <TreeContextMenu
          path={contextMenu.path}
          x={contextMenu.x}
          y={contextMenu.y}
          hasChildren={contextMenu.hasChildren}
          onClose={() => setContextMenu(null)}
          onCreate={(parentPath, name, data) => createNode(parentPath, name, data)}
          onDelete={(path, recursive) => deleteNode(path, recursive)}
          onCopyPath={(path) => navigator.clipboard.writeText(path)}
          onRefresh={(path) => ensureChildrenLoaded(path, { force: true })}
        />
      )}
    </div>
  );
}
