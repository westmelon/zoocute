import { useState } from "react";
import type { SavedConnection } from "../lib/types";
import { ScrollArea } from "./scroll-area";

// ─── ConnectionPane（左面板列表）────────────────────────
interface ConnectionPaneProps {
  connections: SavedConnection[];
  selectedId: string | null;
  connectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onConnect: (c: SavedConnection) => void;
  onDisconnect: (id: string) => void;
}

export function ConnectionPane({
  connections, selectedId, connectedId,
  onSelect, onNew, onConnect, onDisconnect,
}: ConnectionPaneProps) {
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">连接管理</span>
        <button className="btn btn-primary" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={onNew}>
          + 新建
        </button>
      </div>
      <ScrollArea className="conn-list">
        {connections.map((c) => {
          const isSelected = selectedId === c.id;
          const isConnected = connectedId === c.id;
          return (
            <div
              key={c.id}
              className={`conn-card${isSelected ? " selected" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className={`conn-server-icon${isConnected ? " conn-server-icon--on" : ""}`}>▣</span>
              <div className="conn-card-info">
                <div className="conn-card-name">{c.name}</div>
                <div className="conn-card-addr">{c.connectionString}</div>
              </div>
              {isSelected && (
                <div className="conn-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="conn-icon-btn"
                    title={isConnected ? "断开连接" : "连接"}
                    onClick={() => isConnected ? onDisconnect(c.id) : onConnect(c)}
                  >
                    {isConnected ? "⛓️" : "🔗"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {connections.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "12px", padding: "8px" }}>
            暂无连接，点击「+ 新建」添加
          </p>
        )}
      </ScrollArea>
    </>
  );
}

// ─── ConnectionDetail（右侧表单）────────────────────────
interface ConnectionDetailProps {
  connection: SavedConnection;
  isConnected: boolean;
  onSave: (c: SavedConnection) => void;
  onTestConnect: (c: SavedConnection) => void;
  onDelete: (id: string) => void;
}

export function ConnectionDetail({ connection, isConnected, onSave, onTestConnect, onDelete }: ConnectionDetailProps) {
  const [form, setForm] = useState<SavedConnection>(connection);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when connection prop changes
  if (form.id !== connection.id) {
    setForm(connection);
    setErrors({});
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.connectionString.trim()) next.connectionString = "连接地址不能为空";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function update(field: keyof SavedConnection, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="conn-form">
      <p className="conn-form-title">{form.name || "新连接"}</p>
      <div className="form-grid">
        <label className="form-label">连接地址</label>
        <div>
          <input
            className={`form-input${errors.connectionString ? " form-input-error" : ""}`}
            value={form.connectionString}
            onChange={(e) => update("connectionString", e.target.value)}
            placeholder="host:port"
          />
          {errors.connectionString && (
            <p className="form-error-msg">{errors.connectionString}</p>
          )}
        </div>
        <label className="form-label">名称</label>
        <input
          className="form-input"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">用户名</label>
        <input
          className="form-input"
          value={form.username ?? ""}
          onChange={(e) => update("username", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">密码</label>
        <input
          type="password"
          className="form-input"
          value={form.password ?? ""}
          onChange={(e) => update("password", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">超时 (ms)</label>
        <input
          className="form-input"
          type="number"
          value={form.timeoutMs}
          onChange={(e) => update("timeoutMs", parseInt(e.target.value, 10))}
        />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={() => { if (validate()) onTestConnect(form); }}>
          测试连接
        </button>
        <button className="btn" onClick={() => { if (validate()) onSave(form); }}>
          保存
        </button>
        {!isConnected && (
          <button className="btn btn-danger form-actions-right" onClick={() => onDelete(form.id)}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}
