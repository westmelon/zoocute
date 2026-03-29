import type { ActiveSession } from "../lib/types";

interface ServerTabsProps {
  sessions: Map<string, ActiveSession>;
  activeTabId: string | null;
  onTabSelect: (connectionId: string) => void;
  onTabClose: (connectionId: string) => void;
}

export function ServerTabs({
  sessions,
  activeTabId,
  onTabSelect,
  onTabClose,
}: ServerTabsProps) {
  return (
    <div className="server-tabs">
      {[...sessions.entries()].map(([id, session]) => (
        <div
          key={id}
          className={`server-tab${id === activeTabId ? " server-tab--active" : ""}`}
          onClick={() => onTabSelect(id)}
        >
          <span className="server-tab-dot" />
          <span className="server-tab-name">{session.connection.name}</span>
          <button
            className="server-tab-close"
            title="断开连接"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
