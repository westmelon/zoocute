import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./settings-panel";

describe("SettingsPanel", () => {
  it("renders theme and write mode radios plus plugin directory actions", () => {
    render(
      <SettingsPanel
        isOpen={true}
        settings={{ theme: "system", writeMode: "readonly", pluginDirectory: null }}
        effectivePluginDirectory="C:/Users/test/AppData/Roaming/zoocute/plugins"
        onClose={vi.fn()}
        onThemeChange={vi.fn()}
        onWriteModeChange={vi.fn()}
        onChoosePluginDirectory={vi.fn()}
        onResetPluginDirectory={vi.fn()}
        onOpenPluginDirectory={vi.fn()}
      />
    );

    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByLabelText("跟随系统")).toBeInTheDocument();
    expect(screen.getByText("安全")).toBeInTheDocument();
    expect(screen.getByLabelText("只读")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复默认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开插件目录" })).toBeInTheDocument();
  });

  it("emits immediate changes when radio options are selected", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    const onWriteModeChange = vi.fn();

    render(
      <SettingsPanel
        isOpen={true}
        settings={{ theme: "system", writeMode: "readonly", pluginDirectory: null }}
        effectivePluginDirectory="C:/Users/test/AppData/Roaming/zoocute/plugins"
        onClose={vi.fn()}
        onThemeChange={onThemeChange}
        onWriteModeChange={onWriteModeChange}
        onChoosePluginDirectory={vi.fn()}
        onResetPluginDirectory={vi.fn()}
        onOpenPluginDirectory={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText("暗夜"));
    await user.click(screen.getByLabelText("读写"));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onWriteModeChange).toHaveBeenCalledWith("readwrite");
  });
});
