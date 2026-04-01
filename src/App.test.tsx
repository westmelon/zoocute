import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, vi } from "vitest";

const { defaultInvokeImplementation, invokeMock } = vi.hoisted(() => {
  const defaultInvokeImplementation = async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "load_persisted_connections":
        return {
          connections: {
            savedConnections: [
              { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
            ],
            selectedConnectionId: "local",
          },
          status: { kind: "loaded", message: null },
        };
      case "save_persisted_connections":
        return args?.connections;
      case "get_app_settings":
        return { theme: "system", writeMode: "readonly", pluginDirectory: null };
      case "get_runtime_info":
        return { mode: "standard", dataRoot: "C:/Users/test/AppData/Roaming/zoocute" };
      case "get_effective_plugin_directory":
        return "";
      case "list_parser_plugins":
        return [];
      default:
        return undefined;
    }
  };

  return {
    defaultInvokeImplementation,
    invokeMock: vi.fn(defaultInvokeImplementation),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import App from "./App";

function getSettingsButton() {
  const buttons = document.querySelectorAll(".ribbon-btn");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.removeItem("zoocute:settings");
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultInvokeImplementation);
});

it("renders the ribbon shell with the settings entry", () => {
  render(<App />);
  expect(document.querySelector(".ribbon")).toBeInTheDocument();
  expect(getSettingsButton()).toBeInTheDocument();
});

it("starts in connections mode showing the connection list", () => {
  render(<App />);
  expect(document.querySelector(".conn-list")).toBeInTheDocument();
  expect(document.querySelector(".server-tabs")).not.toBeInTheDocument();
});

it("opens the settings panel from the ribbon button with readonly selected by default", async () => {
  const user = userEvent.setup();

  render(<App />);
  await user.click(getSettingsButton());

  expect(screen.getByText("外观")).toBeInTheDocument();
  expect(screen.getByLabelText("只读")).toBeChecked();
});

it("shows portable mode plugin directory UI when runtime info reports portable mode", async () => {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "get_runtime_info":
        return { mode: "portable", dataRoot: "D:/portable/zoo_data" };
      case "get_effective_plugin_directory":
        return "D:/portable/zoo_data/plugins";
      default:
        return defaultInvokeImplementation(command, args);
    }
  });

  const user = userEvent.setup();
  render(<App />);
  await user.click(getSettingsButton());

  expect(screen.getByText("Portable Mode")).toBeInTheDocument();
  expect(screen.getByText("D:/portable/zoo_data/plugins")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "选择目录" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "恢复默认" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开插件目录" })).toBeInTheDocument();
});

it("shows a success toast after saving a connection", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.clear(screen.getByLabelText("名称"));
  await user.type(screen.getByLabelText("名称"), "新的本地连接");
  await user.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();
  expect(screen.getByDisplayValue("新的本地连接")).toBeInTheDocument();
});

it("auto-hides the success toast after a short delay", async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);

  await user.clear(screen.getByLabelText("名称"));
  await user.type(screen.getByLabelText("名称"), "新的本地连接");
  await user.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(2500);
  });

  expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  vi.useRealTimers();
});
