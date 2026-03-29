import { useState } from "react";
import type { NodeDetails } from "../lib/types";

interface NodeHeaderProps {
  node: NodeDetails;
  isEditing: boolean;
  isDirty: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
}

export function NodeHeader({ node, isEditing, isDirty, onEnterEdit, onExitEdit }: NodeHeaderProps) {
  const [showCautiousWarning, setShowCautiousWarning] = useState(false);

  const canToggleEdit = node.editable || node.dataKind === "cautious";

  function handleToggle() {
    if (isEditing) {
      onExitEdit();
      return;
    }
    if (node.dataKind === "cautious") {
      setShowCautiousWarning(true);
      return;
    }
    onEnterEdit();
  }

  function confirmCautious() {
    setShowCautiousWarning(false);
    onEnterEdit();
  }

  const pillClass =
    node.dataKind === "binary"
      ? "mode-pill mode-pill--readonly"
      : node.dataKind === "cautious"
        ? "mode-pill mode-pill--cautious"
        : "mode-pill";

  return (
    <div className="content-header">
      <div className="content-header-main">
        <span className="node-path">{node.path}</span>
      </div>
      <div className="content-header-actions">
        <span className={pillClass}>{node.displayModeLabel}</span>

        {canToggleEdit && (
          <button
            type="button"
            className={`edit-toggle${isEditing ? " edit-toggle--active" : ""}`}
            onClick={handleToggle}
            aria-label={isEditing ? "退出编辑" : "开启编辑"}
            aria-pressed={isEditing}
          >
            {isEditing ? "编辑中" : "开启编辑"}
          </button>
        )}

        {isDirty && <span className="unsaved-badge">未保存</span>}
      </div>

      {showCautiousWarning && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-labelledby="cautious-warning-title"
            aria-modal="true"
          >
            <p className="dialog-title" id="cautious-warning-title">注意</p>
            <div className="dialog-body">
              <p>此节点内容可能改变原始格式，继续编辑后保存将以所见内容为准。</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setShowCautiousWarning(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={confirmCautious}>继续编辑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
