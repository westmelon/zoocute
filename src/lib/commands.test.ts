import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  listParserPlugins,
  loadPersistedConnections,
  runParserPlugin,
  savePersistedConnections,
} from "./commands";

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

describe("persisted connection command wrappers", () => {
  it("invokes load_persisted_connections with no payload", async () => {
    invokeMock.mockResolvedValueOnce({
      connections: {
        savedConnections: [{ id: "local", name: "Local", connectionString: "127.0.0.1:2181", timeoutMs: 5000 }],
        selectedConnectionId: "local",
      },
      status: { kind: "loaded", message: null },
    });

    const result = await loadPersistedConnections();

    expect(result).toEqual({
      connections: {
        savedConnections: [{ id: "local", name: "Local", connectionString: "127.0.0.1:2181", timeoutMs: 5000 }],
        selectedConnectionId: "local",
      },
      status: { kind: "loaded", message: null },
    });
    expect(invokeMock).toHaveBeenCalledWith("load_persisted_connections");
  });

  it("invokes save_persisted_connections with the expected payload shape", async () => {
    const payload = {
      savedConnections: [{ id: "prod", name: "Prod", connectionString: "10.0.0.1:2181", timeoutMs: 5000 }],
      selectedConnectionId: "prod",
    };
    invokeMock.mockResolvedValueOnce(payload);

    const result = await savePersistedConnections(payload);

    expect(result).toEqual(payload);
    expect(invokeMock).toHaveBeenCalledWith("save_persisted_connections", {
      connections: payload,
    });
  });
});
