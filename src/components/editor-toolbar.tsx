import type { Charset, ParserPlugin, ViewMode } from "../lib/types";

interface EditorToolbarProps {
  isEditing: boolean;
  isDirty: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  charset: Charset;
  onCharsetChange: (charset: Charset) => void;
  isTextNode: boolean;
  onDiff: () => void;
  onDiscard: () => void;
  onSave: () => void;
  plugins?: ParserPlugin[];
  selectedPluginId?: string;
  onPluginChange?: (pluginId: string) => void;
  onParsePlugin?: () => void;
  pluginResultAvailable?: boolean;
  isPluginParsing?: boolean;
}

const VIEW_MODES: { value: ViewMode; label: string; requiresResult?: boolean }[] = [
  { value: "raw", label: "RAW" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "plugin", label: "PLUGIN", requiresResult: true },
];

const CHARSETS: Charset[] = ["UTF-8", "GBK", "ISO-8859-1"];

export function EditorToolbar({
  isEditing,
  isDirty,
  viewMode,
  onViewModeChange,
  charset,
  onCharsetChange,
  isTextNode,
  onDiff,
  onDiscard,
  onSave,
  plugins = [],
  selectedPluginId = "",
  onPluginChange = () => {},
  onParsePlugin = () => {},
  pluginResultAvailable = false,
  isPluginParsing = false,
}: EditorToolbarProps) {
  const visibleModes = VIEW_MODES.filter((mode) => !mode.requiresResult || pluginResultAvailable);

  return (
    <div className="editor-toolbar">
      <div className="toolbar-view-tabs" role="group" aria-label="查看模式">
        {visibleModes.map((m, index) => (
          <div key={m.value} className="toolbar-view-segment">
            <button
              type="button"
              className={`toolbar-tab${viewMode === m.value ? " active" : ""}`}
              onClick={() => onViewModeChange(m.value)}
              aria-pressed={viewMode === m.value}
              disabled={isEditing}
            >
              {m.label}
            </button>
            {index < visibleModes.length - 1 ? <span className="toolbar-view-divider" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>

      {isTextNode && (
        <select
          aria-label="字符编码"
          className="toolbar-charset-select"
          value={charset}
          onChange={(e) => onCharsetChange(e.target.value as Charset)}
        >
          {CHARSETS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {plugins.length > 0 ? (
        <>
          <select
            aria-label="Plugin"
            className="toolbar-plugin-select"
            value={selectedPluginId}
            onChange={(e) => onPluginChange(e.target.value)}
          >
            <option value="">Select plugin</option>
            {plugins.map((plugin) => (
              <option key={plugin.id} value={plugin.id}>
                {plugin.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn"
            onClick={onParsePlugin}
            disabled={!selectedPluginId || isPluginParsing}
          >
            {isPluginParsing ? "Parsing..." : "Parse"}
          </button>
        </>
      ) : null}

      <div className="toolbar-sep" />

      {isEditing && (
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn"
            onClick={onDiff}
            disabled={!isDirty}
          >
            查看 Diff
          </button>
          <button
            type="button"
            className="btn"
            onClick={onDiscard}
          >
            放弃修改
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={!isDirty}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}
