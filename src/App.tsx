import "./styles/app.css";
import "overlayscrollbars/overlayscrollbars.css";
import { useEffect, useState } from "react";
import { applyThemePreference, watchSystemThemePreference } from "./app-bootstrap";
import { usePanelResize } from "./hooks/use-panel-resize";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { Ribbon } from "./components/ribbon";
import { BrowserPane } from "./components/browser-pane";
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";
import { EditorPanel } from "./components/editor-panel";
import { TreeContextMenu } from "./components/tree-context-menu";
import { ServerTabs } from "./components/server-tabs";
import { LogFilterPane, LogListPane } from "./components/log-pane";
import { SettingsPanel } from "./components/settings-panel";
import { useLogState } from "./hooks/use-log-state";
import {
  choosePluginDirectory,
  getAppSettings,
  getEffectivePluginDirectory,
  getRuntimeInfo,
  listParserPlugins,
  openPluginDirectory,
  resetPluginDirectory,
  runParserPlugin,
  setThemePreference,
  setWriteMode,
} from "./lib/commands";
import { DEFAULT_APP_SETTINGS } from "./lib/settings";
import type { AppSettings, RuntimeMode, ThemePreference, WriteMode } from "./lib/types";

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [effectivePluginDirectory, setEffectivePluginDirectory] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("standard");
  const [pluginRefreshToken, setPluginRefreshToken] = useState(0);
  const isReadOnly = settings.writeMode === "readonly";

  const {
    ribbonMode, setRibbonMode,
    hasActiveSessions,
    sessions, activeTabId, setActiveTabId,
    activeSession,
    activePath, activeNode,
    drafts,
    treeNodes, expandedPaths, loadingPaths,
    connectionError,
    connectionNotice,
    saveError,
    showConnectionError,
    openNode, toggleNode, ensureChildrenLoaded,
    pendingNavPath, confirmNavAndDiscard, cancelPendingNav,
    updateDraft, discardDraft, handleSave,
    isEditing,
    enterEditMode,
    exitEditMode,
    fetchServerValue,
    createNode, deleteNode,
    submitConnection, testConnection, disconnectSession,
    showConnectionNotice,
    isConnecting, connectionAction, pendingConnectionId,
    savedConnections, setSavedConnections,
    selectedConnectionId, setSelectedConnectionId,
    searchQuery, setSearchQuery, searchResults, searchMode, locate, isIndexing,
  } = useWorkbenchState(isReadOnly);

  const { width: sidebarWidth, onMouseDown: onResizeMouseDown } = usePanelResize(
    220, "zoocute:sidebar-width"
  );

  const logState = useLogState(ribbonMode === "log");
  const draft = activePath ? drafts[activePath] : undefined;
  const selectedConn =
    savedConnections.find((connection) => connection.id === selectedConnectionId) ?? savedConnections[0];

  const [contextMenu, setContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
    hasChildren: boolean;
  } | null>(null);

  const showTabs = ribbonMode === "browse" && hasActiveSessions;

  useEffect(() => {
    let cancelled = false;

    void getAppSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        applyThemePreference(next.theme);
      })
      .catch(() => undefined);

    void getEffectivePluginDirectory()
      .then((path) => {
        if (!cancelled) setEffectivePluginDirectory(path);
      })
      .catch(() => undefined);

    void getRuntimeInfo()
      .then((info) => {
        if (!cancelled) setRuntimeMode(info.mode);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => watchSystemThemePreference(settings.theme), [settings.theme]);

  async function syncSettings(next: AppSettings) {
    setSettings(next);
    applyThemePreference(next.theme);
    try {
      const path = await getEffectivePluginDirectory();
      setEffectivePluginDirectory(path);
    } catch {
      setEffectivePluginDirectory(next.pluginDirectory ?? "");
    }
  }

  async function handleThemeChange(theme: ThemePreference) {
    const next = await setThemePreference(theme).catch(() => ({
      ...settings,
      theme,
    }));
    await syncSettings(next);
  }

  async function handleWriteModeChange(writeMode: WriteMode) {
    const next = await setWriteMode(writeMode).catch(() => ({
      ...settings,
      writeMode,
    }));
    await syncSettings(next);
  }

  async function handleChoosePluginDirectory() {
    const next = await choosePluginDirectory().catch(() => null);
    if (!next) return;
    await syncSettings(next);
    setPluginRefreshToken((current) => current + 1);
  }

  async function handleResetPluginDirectory() {
    const next = await resetPluginDirectory().catch(() => ({
      ...settings,
      pluginDirectory: null,
    }));
    await syncSettings(next);
    setPluginRefreshToken((current) => current + 1);
  }

  async function handleOpenPluginDirectory() {
    try {
      await openPluginDirectory();
    } catch (error) {
      showConnectionError(error instanceof Error ? error.message : "打开插件目录失败");
    }
  }

  return (
    <div className="app-shell">
      <Ribbon
        mode={ribbonMode}
        onModeChange={setRibbonMode}
        hasActiveSessions={hasActiveSessions}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      {connectionError && (
        <div className="error-toast">{connectionError}</div>
      )}
      {connectionNotice && (
        <div className="success-toast">{connectionNotice}</div>
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
            onContextMenu={(path, event) => {
              const node = treeNodes
                .flatMap(function flatten(current): typeof treeNodes {
                  return [current, ...(current.children ?? []).flatMap(flatten)];
                })
                .find((current) => current.path === path);
              setContextMenu({
                path,
                x: event.clientX,
                y: event.clientY,
                hasChildren: !!node?.hasChildren,
              });
            }}
          />
        )}
        {ribbonMode === "connections" && (
          <ConnectionPane
            connections={savedConnections}
            selectedId={selectedConnectionId}
            connectedIds={new Set(sessions.keys())}
            isConnecting={isConnecting}
            pendingConnectionId={pendingConnectionId}
            onSelect={setSelectedConnectionId}
            onNew={() => {
              const newConnection = {
                id: Date.now().toString(),
                name: "新连接",
                connectionString: "",
                timeoutMs: 5000,
              };
              setSavedConnections((current) => [...current, newConnection]);
              setSelectedConnectionId(newConnection.id);
            }}
            onConnect={(connection) =>
              submitConnection({
                connectionString: connection.connectionString,
                username: connection.username ?? "",
                password: connection.password ?? "",
                connectionId: connection.id,
              })
            }
            onDisconnect={disconnectSession}
            onDelete={(id) => {
              setSavedConnections((current) => current.filter((connection) => connection.id !== id));
              setSelectedConnectionId(
                savedConnections.find((connection) => connection.id !== id)?.id ?? null
              );
            }}
          />
        )}
        {ribbonMode === "log" && (
          <LogFilterPane
            filters={logState.filters}
            onFiltersChange={logState.setFilters}
            loading={logState.loading}
            onRefresh={logState.refresh}
            onClear={logState.clear}
            connections={savedConnections.map((connection) => ({
              id: connection.id,
              name: connection.name,
            }))}
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
            isReadOnly={isReadOnly}
            onEnterEdit={() => activePath && enterEditMode(activePath)}
            onExitEdit={() => activePath && exitEditMode(activePath)}
            onDraftChange={(value) => activePath && updateDraft(activePath, value)}
            onSave={(value, charset) => activePath && handleSave(activePath, value, charset)}
            onDiscard={() => activePath && discardDraft(activePath)}
            onFetchServerValue={() => activePath ? fetchServerValue(activePath) : Promise.resolve(null)}
            pendingNavPath={pendingNavPath}
            onConfirmNavAndDiscard={confirmNavAndDiscard}
            onCancelPendingNav={cancelPendingNav}
            connectionId={activeTabId ?? ""}
            nodePath={activePath ?? ""}
            pluginRefreshToken={pluginRefreshToken}
            onListParserPlugins={listParserPlugins}
            onRunParserPlugin={runParserPlugin}
            onPluginError={showConnectionError}
          />
        )}

        {ribbonMode === "browse" && activeSession && !activeNode && (
          <div className="placeholder-pane">选择左侧节点查看详情</div>
        )}

        {ribbonMode === "connections" && selectedConn && (
          <ConnectionDetail
            connection={selectedConn}
            isConnecting={isConnecting && pendingConnectionId === selectedConn.id}
            isTesting={connectionAction === "test" && pendingConnectionId === selectedConn.id}
            onSave={(connection) => {
              setSavedConnections((current) =>
                current.map((item) => (item.id === connection.id ? connection : item))
              );
              showConnectionNotice("保存成功");
            }}
            onTestConnect={(connection) =>
              testConnection({
                connectionString: connection.connectionString,
                username: connection.username ?? "",
                password: connection.password ?? "",
                connectionId: connection.id,
              })
            }
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
          isReadOnly={isReadOnly}
          onClose={() => setContextMenu(null)}
          onCreate={(parentPath, name, data) => createNode(parentPath, name, data)}
          onDelete={(path, recursive) => deleteNode(path, recursive)}
          onCopyPath={(path) => navigator.clipboard.writeText(path)}
          onRefresh={(path) => ensureChildrenLoaded(path, { force: true })}
        />
      )}

      <SettingsPanel
        isOpen={isSettingsOpen}
        settings={settings}
        runtimeMode={runtimeMode}
        effectivePluginDirectory={effectivePluginDirectory}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={(theme) => void handleThemeChange(theme)}
        onWriteModeChange={(writeMode) => void handleWriteModeChange(writeMode)}
        onChoosePluginDirectory={() => void handleChoosePluginDirectory()}
        onResetPluginDirectory={() => void handleResetPluginDirectory()}
        onOpenPluginDirectory={() => void handleOpenPluginDirectory()}
      />
    </div>
  );
}
