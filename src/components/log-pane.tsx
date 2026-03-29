import type { ZkLogEntry } from "../lib/types";
import type { LogFilters } from "../hooks/use-log-state";
import { ScrollArea } from "./scroll-area";

// ─── Left sidebar ───────────────────────────────────────────────────────────

interface LogFilterPaneProps {
  filters: LogFilters;
  onFiltersChange: (f: LogFilters) => void;
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
  connections: { id: string; name: string }[];
}

export function LogFilterPane({
  filters, onFiltersChange, loading, onRefresh, onClear, connections,
}: LogFilterPaneProps) {
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">日志筛选</span>
      </div>

      <div className="log-filter-section">
        <div className="log-filter-label">状态</div>
        <div className="log-filter-row">
          {(
            [
              { label: "全部", value: null },
              { label: "成功", value: true },
              { label: "失败", value: false },
            ] as { label: string; value: boolean | null }[]
          ).map(({ label, value }) => (
            <button
              key={label}
              className={`log-filter-chip${filters.success === value ? " active" : ""}`}
              onClick={() => onFiltersChange({ ...filters, success: value })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="log-filter-label" style={{ marginTop: 10 }}>连接</div>
        <select
          className="log-conn-select"
          value={filters.connectionId}
          onChange={(e) => onFiltersChange({ ...filters, connectionId: e.target.value })}
        >
          <option value="">全部连接</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="log-filter-actions">
        <button className="btn" onClick={onRefresh} disabled={loading}>
          {loading ? "加载中…" : "刷新"}
        </button>
        <button className="btn btn-danger" onClick={onClear}>
          清空日志
        </button>
      </div>
    </>
  );
}

// ─── Right content area ─────────────────────────────────────────────────────

interface LogListPaneProps {
  entries: ZkLogEntry[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

export function LogListPane({ entries, loading, error, onRefresh }: LogListPaneProps) {
  if (loading && entries.length === 0) {
    return <div className="placeholder-pane">加载日志中…</div>;
  }

  if (error) {
    return (
      <div className="placeholder-pane" style={{ flexDirection: "column", gap: 8 }}>
        <span style={{ color: "var(--danger)" }}>{error}</span>
        <button className="btn" onClick={onRefresh}>重试</button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="placeholder-pane">暂无日志记录</div>;
  }

  return (
    <ScrollArea className="log-list-scroll">
      {entries.map((entry, i) => (
        <div key={i} className={`log-entry${entry.success ? "" : " log-entry--error"}`}>
          <div className="log-entry-header">
            <span className={`log-entry-badge${entry.success ? " log-entry-badge--ok" : " log-entry-badge--err"}`}>
              {entry.success ? "OK" : "ERR"}
            </span>
            <span className="log-entry-op">{entry.operation}</span>
            {entry.path && (
              <span className="log-entry-path">{entry.path}</span>
            )}
            <span className="log-entry-meta">
              {entry.connectionId && (
                <span className="log-entry-conn">{entry.connectionId}</span>
              )}
              <span className="log-entry-duration">{entry.durationMs}ms</span>
              <span className="log-entry-time">{formatTime(entry.timestamp)}</span>
            </span>
          </div>
          {entry.error && (
            <div className="log-entry-error">{entry.error}</div>
          )}
        </div>
      ))}
    </ScrollArea>
  );
}
