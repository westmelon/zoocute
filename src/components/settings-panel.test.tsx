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
        runtimeMode="standard"
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

  it("shows a portable mode indicator and read-only plugin directory info in portable mode", () => {
    render(
      <SettingsPanel
        isOpen={true}
        settings={{ theme: "system", writeMode: "readonly", pluginDirectory: null }}
        runtimeMode="portable"
        effectivePluginDirectory="D:/portable/zoo_data/plugins"
        onClose={vi.fn()}
        onThemeChange={vi.fn()}
        onWriteModeChange={vi.fn()}
        onChoosePluginDirectory={vi.fn()}
        onResetPluginDirectory={vi.fn()}
        onOpenPluginDirectory={vi.fn()}
      />
    );

    expect(screen.getByText("Portable Mode")).toBeInTheDocument();
    expect(screen.getByText("便携版插件目录固定为程序目录下的 zoo_data/plugins")).toBeInTheDocument();
    expect(screen.getByText("D:/portable/zoo_data/plugins")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复默认" })).not.toBeInTheDocument();
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
        runtimeMode="standard"
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
