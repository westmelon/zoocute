import type { RibbonMode } from "../lib/types";

interface RibbonProps {
  mode: RibbonMode;
  onModeChange: (mode: RibbonMode) => void;
  hasActiveSessions: boolean;
  onOpenSettings: () => void;
}

const ALL_MODES: { mode: RibbonMode; icon: string; title: string }[] = [
  { mode: "browse", icon: "🌲", title: "节点浏览" },
  { mode: "connections", icon: "🔌", title: "连接管理" },
  { mode: "log", icon: "📋", title: "操作日志" },
];

export function Ribbon({ mode, onModeChange, hasActiveSessions, onOpenSettings }: RibbonProps) {
  const visibleModes = ALL_MODES.filter(
    (current) => current.mode === "connections" || hasActiveSessions
  );

  return (
    <nav className="ribbon">
      <div className="ribbon-logo">🐾</div>
      {visibleModes.map(({ mode: currentMode, icon, title }) => (
        <button
          key={currentMode}
          className={`ribbon-btn${mode === currentMode ? " active" : ""}`}
          title={title}
          onClick={() => onModeChange(currentMode)}
        >
          {icon}
        </button>
      ))}
      <div className="ribbon-spacer" />
      <button className="ribbon-btn" title="设置" onClick={onOpenSettings}>
        ⚙️
      </button>
    </nav>
  );
}
