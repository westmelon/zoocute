import type { AppSettings, ThemePreference, WriteMode } from "../lib/types";

interface SettingsPanelProps {
  isOpen: boolean;
  settings: AppSettings;
  effectivePluginDirectory: string;
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onWriteModeChange: (mode: WriteMode) => void;
  onChoosePluginDirectory: () => void;
  onResetPluginDirectory: () => void;
  onOpenPluginDirectory: () => void;
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "明亮" },
  { value: "dark", label: "暗夜" },
];

const WRITE_MODES: { value: WriteMode; label: string }[] = [
  { value: "readonly", label: "只读" },
  { value: "readwrite", label: "读写" },
];

export function SettingsPanel({
  isOpen,
  settings,
  effectivePluginDirectory,
  onClose,
  onThemeChange,
  onWriteModeChange,
  onChoosePluginDirectory,
  onResetPluginDirectory,
  onOpenPluginDirectory,
}: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="settings-panel-backdrop" onClick={onClose}>
      <aside
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-panel__header">
          <div>
            <p className="settings-panel__eyebrow">Settings</p>
            <h2 className="settings-panel__title" id="settings-panel-title">设置</h2>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <section className="settings-section">
          <h3>外观</h3>
          <div className="settings-radio-group" role="radiogroup" aria-label="主题模式">
            {THEMES.map((option) => (
              <label key={option.value} className="settings-radio">
                <input
                  type="radio"
                  name="theme"
                  checked={settings.theme === option.value}
                  onChange={() => onThemeChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>安全</h3>
          <p className="settings-section__hint">只读模式下禁止新增、修改、删除节点。</p>
          <div className="settings-radio-group" role="radiogroup" aria-label="读写模式">
            {WRITE_MODES.map((option) => (
              <label key={option.value} className="settings-radio">
                <input
                  type="radio"
                  name="write-mode"
                  checked={settings.writeMode === option.value}
                  onChange={() => onWriteModeChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>插件</h3>
          <p className="settings-section__hint">当前插件目录</p>
          <code className="settings-path">{effectivePluginDirectory || "未获取到目录"}</code>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={onChoosePluginDirectory}>
              选择目录
            </button>
            <button type="button" className="btn" onClick={onResetPluginDirectory}>
              恢复默认
            </button>
            <button type="button" className="btn btn-primary" onClick={onOpenPluginDirectory}>
              打开插件目录
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
