import { useRef, useState } from "react";
import type { SavedConnection } from "../lib/types";
import { ScrollArea } from "./scroll-area";

function ConnectedStatusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="2.2" />
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}

function DisconnectedStatusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="2.2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.1 5.3 4.6 6.8a2.4 2.4 0 0 0 0 3.4 2.4 2.4 0 0 0 3.4 0l1.5-1.5" />
      <path d="m9.9 10.7 1.5-1.5a2.4 2.4 0 0 0 0-3.4 2.4 2.4 0 0 0-3.4 0L6.5 7.3" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.1 5.3 4.6 6.8a2.4 2.4 0 0 0 0 3.4 2.4 2.4 0 0 0 3.4 0l.9-.9" />
      <path d="m9.9 10.7 1.5-1.5a2.4 2.4 0 0 0 0-3.4 2.4 2.4 0 0 0-3.4 0l-.9.9" />
      <path d="M5 11 11 5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.8 4.6h8.4" />
      <path d="M6.2 4.6V3.5h3.6v1.1" />
      <path d="M5 6.1v5.4" />
      <path d="M8 6.1v5.4" />
      <path d="M11 6.1v5.4" />
      <path d="m4.7 4.6.5 7.1c.1.8.5 1.3 1.3 1.3h2.9c.8 0 1.2-.5 1.3-1.3l.5-7.1" />
    </svg>
  );
}

// ─── ConnectionPane（左面板列表）────────────────────────
interface ConnectionPaneProps {
  connections: SavedConnection[];
  selectedId: string | null;
  connectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onConnect: (c: SavedConnection) => void;
  onDisconnect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConnectionPane({
  connections, selectedId, connectedId,
  onSelect, onNew, onConnect, onDisconnect, onDelete,
}: ConnectionPaneProps) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTooltipTimer() {
    if (tooltipTimerRef.current !== null) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }

  function hideTooltip() {
    clearTooltipTimer();
    setTooltip(null);
  }

  function scheduleTooltip(text: string, target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return;
    clearTooltipTimer();
    tooltipTimerRef.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const showAbove = rect.top > 44;
      setTooltip({
        text,
        x: rect.left + rect.width / 2,
        y: showAbove ? rect.top - 8 : rect.bottom + 8,
      });
      tooltipTimerRef.current = null;
    }, 500);
  }

  function bindTooltip(text: string) {
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => scheduleTooltip(text, e.currentTarget),
      onMouseLeave: hideTooltip,
      onFocus: (e: React.FocusEvent<HTMLElement>) => scheduleTooltip(text, e.currentTarget),
      onBlur: hideTooltip,
    };
  }

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
              <span
                className={`conn-server-icon conn-tooltip-target${isConnected ? " conn-server-icon--on" : ""}`}
                data-tooltip={isConnected ? `${c.name} 已连接` : `${c.name} 未连接`}
                {...bindTooltip(isConnected ? `${c.name} 已连接` : `${c.name} 未连接`)}
              >
                {isConnected ? <ConnectedStatusIcon /> : <DisconnectedStatusIcon />}
              </span>
              <div className="conn-card-info">
                <div className="conn-card-name">{c.name}</div>
                <div className="conn-card-addr">{c.connectionString}</div>
              </div>
              <div className="conn-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="conn-icon-btn conn-tooltip-target"
                  data-tooltip={isConnected ? `断开 ${c.name}` : `连接 ${c.name}`}
                  aria-label={isConnected ? `断开 ${c.name}` : `连接 ${c.name}`}
                  onClick={() => isConnected ? onDisconnect(c.id) : onConnect(c)}
                  {...bindTooltip(isConnected ? `断开 ${c.name}` : `连接 ${c.name}`)}
                >
                  {isConnected ? <UnlinkIcon /> : <LinkIcon />}
                </button>
                {!isConnected && (
                  <button
                    className="conn-icon-btn conn-icon-btn--danger conn-tooltip-target"
                    data-tooltip={`删除 ${c.name}`}
                    aria-label={`删除 ${c.name}`}
                    onClick={() => onDelete(c.id)}
                    {...bindTooltip(`删除 ${c.name}`)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {connections.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "12px", padding: "8px" }}>
            暂无连接，点击「+ 新建」添加
          </p>
        )}
      </ScrollArea>
      {tooltip && (
        <div
          className="conn-floating-tooltip"
          role="tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}

// ─── ConnectionDetail（右侧表单）────────────────────────
interface ConnectionDetailProps {
  connection: SavedConnection;
  onSave: (c: SavedConnection) => void;
  onTestConnect: (c: SavedConnection) => void;
}

export function ConnectionDetail({ connection, onSave, onTestConnect }: ConnectionDetailProps) {
  const [form, setForm] = useState<SavedConnection>(connection);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fieldId = (name: string) => `conn-${form.id}-${name}`;

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
        <label className="form-label" htmlFor={fieldId("connection-string")}>连接地址</label>
        <div>
          <input
            id={fieldId("connection-string")}
            className={`form-input${errors.connectionString ? " form-input-error" : ""}`}
            value={form.connectionString}
            onChange={(e) => update("connectionString", e.target.value)}
            placeholder="host:port"
          />
          {errors.connectionString && (
            <p className="form-error-msg">{errors.connectionString}</p>
          )}
        </div>
        <label className="form-label" htmlFor={fieldId("name")}>名称</label>
        <input
          id={fieldId("name")}
          className="form-input"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label" htmlFor={fieldId("username")}>用户名</label>
        <input
          id={fieldId("username")}
          className="form-input"
          value={form.username ?? ""}
          onChange={(e) => update("username", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label" htmlFor={fieldId("password")}>密码</label>
        <input
          id={fieldId("password")}
          type="password"
          className="form-input"
          value={form.password ?? ""}
          onChange={(e) => update("password", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label" htmlFor={fieldId("timeout")}>超时 (ms)</label>
        <input
          id={fieldId("timeout")}
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
      </div>
    </div>
  );
}
