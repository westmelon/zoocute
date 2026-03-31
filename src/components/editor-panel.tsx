// src/components/editor-panel.tsx
import { useEffect, useState } from "react";
import type { Charset, NodeDetails, ParserPlugin, ParserPluginResult, ViewMode } from "../lib/types";
import { NodeHeader } from "./node-header";
import { EditorToolbar } from "./editor-toolbar";
import { NodeContentPanel } from "./node-content-panel";
import { DiffPanel } from "./diff-panel";
import { NodeStat } from "./node-stat";

interface EditorPanelProps {
  node: NodeDetails;
  draft: string | undefined;
  saveError: string | null;
  isEditing: boolean;
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
  onListParserPlugins: () => Promise<ParserPlugin[]>;
  onRunParserPlugin: (connectionId: string, path: string, pluginId: string) => Promise<ParserPluginResult>;
  onPluginError: (message: string) => void;
}

export function EditorPanel({
  node,
  draft,
  saveError,
  isEditing,
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

  useEffect(() => {
    let cancelled = false;
    setPlugins((current) => (current.length === 0 ? current : []));
    setSelectedPluginId((current) => (current === "" ? current : ""));
    setPluginResult((current) => (current === null ? current : null));
    setIsPluginParsing((current) => (current === false ? current : false));
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
  }, [nodePath, onListParserPlugins]);

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

  async function handleParsePlugin() {
    if (!selectedPluginId) {
      onPluginError("请先选择插件");
      return;
    }

    setIsPluginParsing(true);
    try {
      const result = await onRunParserPlugin(connectionId, nodePath, selectedPluginId);
      setPluginResult(result);
      setViewMode("plugin");
      setShowDiff(false);
    } catch (error) {
      onPluginError(error instanceof Error ? error.message : "插件解析失败");
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
        onPluginChange={setSelectedPluginId}
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
