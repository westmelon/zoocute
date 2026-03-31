import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { listParserPlugins, runParserPlugin } from "./commands";

describe("parser plugin command wrappers", () => {
  it("invokes list_parser_plugins with no payload", async () => {
    invokeMock.mockResolvedValueOnce([{ id: "a", name: "Plugin A" }]);

    const result = await listParserPlugins();

    expect(result).toEqual([{ id: "a", name: "Plugin A" }]);
    expect(invokeMock).toHaveBeenCalledWith("list_parser_plugins");
  });

  it("invokes run_parser_plugin with the expected payload shape", async () => {
    invokeMock.mockResolvedValueOnce({
      pluginId: "dubbo-provider",
      pluginName: "Dubbo Provider Decoder",
      content: "decoded output",
      generatedAt: 123,
    });

    const result = await runParserPlugin("conn-1", "/services/session_blob", "dubbo-provider");

    expect(result).toEqual({
      pluginId: "dubbo-provider",
      pluginName: "Dubbo Provider Decoder",
      content: "decoded output",
      generatedAt: 123,
    });
    expect(invokeMock).toHaveBeenCalledWith("run_parser_plugin", {
      connectionId: "conn-1",
      path: "/services/session_blob",
      pluginId: "dubbo-provider",
    });
  });
});
