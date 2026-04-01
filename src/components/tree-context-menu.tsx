import { useEffect, useState } from "react";

interface TreeContextMenuProps {
  path: string;
  x: number;
  y: number;
  hasChildren: boolean;
  isReadOnly: boolean;
  onClose: () => void;
  onCreate: (parentPath: string, name: string, data: string) => void;
  onDelete: (path: string, recursive: boolean) => void;
  onCopyPath: (path: string) => void;
  onRefresh: (path: string) => void;
}

export function TreeContextMenu({
  path,
  x,
  y,
  hasChildren,
  isReadOnly,
  onClose,
  onCreate,
  onDelete,
  onCopyPath,
  onRefresh,
}: TreeContextMenuProps) {
  const [mode, setMode] = useState<"menu" | "create" | "delete">("menu");
  const [newName, setNewName] = useState("");
  const [newData, setNewData] = useState("");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (mode === "create") {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(event) => event.stopPropagation()}>
          <p className="dialog-title">创建子节点</p>
          <div className="dialog-body">
            <div className="form-grid">
              <label className="form-label">父路径</label>
              <span
                style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)" }}
              >
                {path}
              </span>
              <label className="form-label">节点名称</label>
              <input
                className="form-input"
                placeholder="例如 my-node"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                autoFocus
              />
              <label className="form-label">初始数据</label>
              <input
                className="form-input"
                placeholder="可为空"
                value={newData}
                onChange={(event) => setNewData(event.target.value)}
              />
            </div>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onCreate(path, newName, newData);
                onClose();
              }}
              disabled={isReadOnly || !newName.trim()}
            >
              创建
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(event) => event.stopPropagation()}>
          <p className="dialog-title">删除节点</p>
          <div className="dialog-body">
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              确认删除 <code style={{ color: "var(--danger)" }}>{path}</code>
            </p>
            {hasChildren && (
              <p style={{ fontSize: "12px", color: "var(--warning)" }}>
                将递归删除所有子节点
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
              disabled={isReadOnly}
              onClick={() => {
                onDelete(path, hasChildren);
                onClose();
              }}
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onMouseLeave={onClose}
    >
      <div
        className={`context-menu-item${isReadOnly ? " context-menu-item--disabled" : ""}`}
        onClick={() => {
          if (!isReadOnly) setMode("create");
        }}
      >
        创建子节点
      </div>
      <div className="context-menu-sep" />
      <div className="context-menu-item" onClick={() => { onCopyPath(path); onClose(); }}>
        复制路径
      </div>
      <div className="context-menu-item" onClick={() => { onRefresh(path); onClose(); }}>
        刷新
      </div>
      <div className="context-menu-sep" />
      <div
        className={`context-menu-item context-menu-item--danger${isReadOnly ? " context-menu-item--disabled" : ""}`}
        onClick={() => {
          if (!isReadOnly) setMode("delete");
        }}
      >
        删除节点
      </div>
    </div>
  );
}
