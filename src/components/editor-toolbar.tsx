import type { Charset, ViewMode } from "../lib/types";

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
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "raw", label: "RAW" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
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
}: EditorToolbarProps) {
  return (
    <div className="editor-toolbar">
      <div className="toolbar-view-tabs" role="group" aria-label="查看模式">
        {VIEW_MODES.map((m, index) => (
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
            {index < VIEW_MODES.length - 1 ? <span className="toolbar-view-divider" aria-hidden="true" /> : null}
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
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}

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
