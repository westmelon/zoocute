// src/components/editor-panel.tsx
import { useEffect, useState } from "react";
import type { Charset, NodeDetails, ParserPlugin, ParserPluginResult, ViewMode } from "../lib/types";
import { NodeHeader } from "./node-header";
import { EditorToolbar } from "./editor-toolbar";
import { NodeContentPanel } from "./node-content-panel";
import { DiffPanel } from "./diff-panel";
import { NodeStat } from "./node-stat";

interface PluginErrorState {
  pluginName: string;
  message: string;
}

function extractPluginErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
    const maybeError = Reflect.get(error, "error");
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }
  }
  return "插件解析失败";
}

function summarizePluginError(message: string): string {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "插件解析失败";
}

interface EditorPanelProps {
  node: NodeDetails;
  draft: string | undefined;
  saveError: string | null;
  isEditing: boolean;
  isReadOnly: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: (value: string) => void;
  onDiscard: () => void;
  onFetchServerValue: () => Promise<string | null>;
  pendingNavPath?: string | null;
  onConfirmNavAndDiscard?: () => void;
  onCancelPendingNav?: () => void;
  connectionId: string;
  nodePath: string;
  pluginRefreshToken?: number;
  onListParserPlugins: () => Promise<ParserPlugin[]>;
  onRunParserPlugin: (
    connectionId: string,
    path: string,
    pluginId: string
  ) => Promise<ParserPluginResult>;
  onPluginError: (message: string) => void;
}

export function EditorPanel({
  node,
  draft,
  saveError,
  isEditing,
  isReadOnly,
  onEnterEdit,
  onExitEdit,
  onDraftChange,
  onSave,
  onDiscard,
  onFetchServerValue,
  pendingNavPath,
  onConfirmNavAndDiscard,
  onCancelPendingNav,
  connectionId,
  nodePath,
  pluginRefreshToken = 0,
  onListParserPlugins,
  onRunParserPlugin,
  onPluginError,
}: EditorPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("raw");
  const [charset, setCharset] = useState<Charset>("UTF-8");
  const [showDiff, setShowDiff] = useState(false);
  const [serverValue, setServerValue] = useState<string | null>(null);
  const [diffError, setDiffError] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [plugins, setPlugins] = useState<ParserPlugin[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState("");
  const [pluginResult, setPluginResult] = useState<ParserPluginResult | null>(null);
  const [isPluginParsing, setIsPluginParsing] = useState(false);
  const [pluginError, setPluginError] = useState<PluginErrorState | null>(null);
  const [isPluginErrorDialogOpen, setIsPluginErrorDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlugins((current) => (current.length === 0 ? current : []));
    setSelectedPluginId((current) => (current === "" ? current : ""));
    setPluginResult((current) => (current === null ? current : null));
    setIsPluginParsing((current) => (current === false ? current : false));
    setPluginError((current) => (current === null ? current : null));
    setIsPluginErrorDialogOpen((current) => (current === false ? current : false));
    setViewMode((current) => (current === "raw" ? current : "raw"));
    setShowDiff((current) => (current === false ? current : false));

    void onListParserPlugins()
      .then((loaded) => {
        if (!cancelled) {
          setPlugins((current) => {
            if (loaded.length === 0) {
              return current.length === 0 ? current : [];
            }
            return loaded;
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlugins((current) => (current.length === 0 ? current : []));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nodePath, onListParserPlugins, pluginRefreshToken]);

  const currentValue = draft ?? node.value;
  const isDirty = draft !== undefined && draft !== node.value;
  const isTextNode = node.dataKind !== "binary";

  async function handleDiff() {
    setDiffError(false);
    const value = await onFetchServerValue();
    if (value === null) {
      setDiffError(true);
      return;
    }
    setServerValue(value);
    setShowDiff(true);
  }

  function handleDiscard() {
    if (!isDirty) {
      onExitEdit();
      return;
    }
    setShowDiscardConfirm(true);
  }

  function confirmDiscard() {
    setShowDiscardConfirm(false);
    setShowDiff(false);
    setServerValue(null);
    onDiscard();
    onExitEdit();
  }

  function handleSave() {
    onSave(currentValue);
    setShowDiff(false);
    setServerValue(null);
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    setShowDiff(false);
  }

  function clearPluginError() {
    setPluginError(null);
    setIsPluginErrorDialogOpen(false);
  }

  function handlePluginChange(pluginId: string) {
    setSelectedPluginId(pluginId);
    clearPluginError();
  }

  async function handleCopyPluginError() {
    if (!pluginError) return;
    try {
      await navigator.clipboard?.writeText(pluginError.message);
    } catch {
      // Best-effort copy only.
    }
  }

  async function handleParsePlugin() {
    if (!selectedPluginId) {
      onPluginError("请先选择插件");
      return;
    }

    setIsPluginParsing(true);
    clearPluginError();
    try {
      const result = await onRunParserPlugin(connectionId, nodePath, selectedPluginId);
      setPluginResult(result);
      clearPluginError();
      setViewMode("plugin");
      setShowDiff(false);
    } catch (error) {
      const message = extractPluginErrorMessage(error);
      const pluginName =
        plugins.find((plugin) => plugin.id === selectedPluginId)?.name ?? selectedPluginId;
      setPluginError({ pluginName, message });
      setIsPluginErrorDialogOpen(false);
      onPluginError(message);
    } finally {
      setIsPluginParsing(false);
    }
  }

  return (
    <div className="editor-pane">
      <NodeHeader
        node={node}
        isEditing={isEditing}
        isDirty={isDirty}
        isReadOnly={isReadOnly}
        onEnterEdit={onEnterEdit}
        onExitEdit={handleDiscard}
      />
      <NodeStat node={node} />
      <EditorToolbar
        isEditing={isEditing}
        isDirty={isDirty}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        charset={charset}
        onCharsetChange={setCharset}
        isTextNode={isTextNode}
        onDiff={handleDiff}
        onDiscard={handleDiscard}
        onSave={handleSave}
        plugins={plugins}
        selectedPluginId={selectedPluginId}
        onPluginChange={handlePluginChange}
        onParsePlugin={handleParsePlugin}
        pluginResultAvailable={pluginResult !== null}
        isPluginParsing={isPluginParsing}
      />
      <NodeContentPanel
        value={currentValue}
        pluginContent={pluginResult?.content}
        viewMode={viewMode}
        isEditing={isEditing}
        onChange={onDraftChange}
        onFallbackToRaw={() => setViewMode("raw")}
      />

      {showDiff && serverValue !== null && (
        <DiffPanel original={serverValue} draft={currentValue} />
      )}

      {diffError && (
        <div className="save-error">无法获取服务端当前值</div>
      )}

      {saveError && (
        <div className="save-error">{saveError}</div>
      )}

      {pluginError && (
        <div className="plugin-error-panel">
          <div className="plugin-error-panel__header">
            <div className="plugin-error-panel__meta">
              <span className="plugin-error-panel__label">Plugin Error</span>
              <span className="plugin-error-panel__name">{pluginError.pluginName}</span>
            </div>
            <div className="plugin-error-panel__actions">
              <button
                type="button"
                className="btn"
                onClick={() => setIsPluginErrorDialogOpen(true)}
              >
                查看详情
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleCopyPluginError()}
              >
                复制
              </button>
            </div>
          </div>
          <p className="plugin-error-panel__summary">
            {summarizePluginError(pluginError.message)}
          </p>
        </div>
      )}

      {isPluginErrorDialogOpen && pluginError && (
        <div className="dialog-backdrop">
          <div
            className="dialog plugin-error-dialog"
            role="alertdialog"
            aria-labelledby="plugin-error-title"
            aria-modal="true"
          >
            <p className="dialog-title" id="plugin-error-title">插件错误详情</p>
            <div className="dialog-body">
              <p className="plugin-error-dialog__plugin">{pluginError.pluginName}</p>
              <pre className="plugin-error-dialog__body">{pluginError.message}</pre>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => void handleCopyPluginError()}>
                复制
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsPluginErrorDialogOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscardConfirm && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-labelledby="discard-confirm-title"
            aria-modal="true"
          >
            <p className="dialog-title" id="discard-confirm-title">放弃修改</p>
            <div className="dialog-body">
              <p>有未保存的修改，确定要放弃吗？</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setShowDiscardConfirm(false)}>
                继续编辑
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDiscard}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingNavPath && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-labelledby="nav-confirm-title"
            aria-modal="true"
          >
            <p className="dialog-title" id="nav-confirm-title">切换节点</p>
            <div className="dialog-body">
              <p>当前节点有未保存的修改，确定要放弃吗？</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onCancelPendingNav}>
                继续编辑
              </button>
              <button type="button" className="btn btn-danger" onClick={onConfirmNavAndDiscard}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
