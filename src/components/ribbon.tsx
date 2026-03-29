import type { RibbonMode } from "../lib/types";

interface RibbonProps {
  mode: RibbonMode;
  onModeChange: (mode: RibbonMode) => void;
  hasActiveSessions: boolean;
}

const ALL_MODES: { mode: RibbonMode; icon: string; title: string }[] = [
  { mode: "browse",      icon: "🌲", title: "节点树" },
  { mode: "connections", icon: "🔌", title: "连接管理" },
  { mode: "log",         icon: "📋", title: "操作日志" },
];

export function Ribbon({ mode, onModeChange, hasActiveSessions }: RibbonProps) {
  const visibleModes = ALL_MODES.filter(
    (m) => m.mode === "connections" || hasActiveSessions
  );
  return (
    <nav className="ribbon">
      <div className="ribbon-logo">🌿</div>
      {visibleModes.map(({ mode: m, icon, title }) => (
        <button
          key={m}
          className={`ribbon-btn${mode === m ? " active" : ""}`}
          title={title}
          onClick={() => onModeChange(m)}
        >
          {icon}
        </button>
      ))}
      <div className="ribbon-spacer" />
      <button className="ribbon-btn" title="设置">⚙️</button>
    </nav>
  );
}
