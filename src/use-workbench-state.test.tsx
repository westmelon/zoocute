import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, expectTypeOf, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import * as commands from "./lib/commands";
import type { ParserPlugin, ParserPluginResult, SavedConnection } from "./lib/types";

const { getNodeDetailsMock } = vi.hoisted(() => ({
  getNodeDetailsMock: vi.fn(async (_connectionId: string, path: string) => ({
    path,
    value: "test",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 1,
    childrenCount: 0,
    updatedAt: "",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    dataLength: 4,
    ephemeral: false,
  })),
}));

vi.mock("./lib/commands", () => ({
  connectServer: vi.fn(async () => ({ connected: true, authMode: "anonymous", authSucceeded: true, message: "" })),
  disconnectServer: vi.fn(async () => {}),
  loadPersistedConnections: vi.fn(async () => ({
    connections: {
      savedConnections: [
        { id: "c1", name: "本地", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
      ],
      selectedConnectionId: "c1",
    },
    status: { kind: "loaded", message: null },
  })),
  savePersistedConnections: vi.fn(async (payload) => payload),
  listChildren: vi.fn(async (_id: string, path: string) => {
    if (path === "/") return [{ path: "/configs", name: "configs", hasChildren: false }];
    return [];
  }),
  getNodeDetails: getNodeDetailsMock,
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
  loadFullTree: vi.fn(async () => []),
  listParserPlugins: vi.fn(async () => []),
  runParserPlugin: vi.fn(async () => ({
    pluginId: "",
    pluginName: "",
    content: "",
    generatedAt: 0,
  })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(async () => vi.fn()),
  }),
}));

const CONN: SavedConnection = { id: "c1", name: "本地", connectionString: "127.0.0.1:2181", timeoutMs: 5000 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

async function connectAndGet() {
  const hook = renderHook(() => useWorkbenchState());
  await waitFor(() => {
    expect(hook.result.current.savedConnections).toEqual([CONN]);
  });
  await act(async () => {
    await hook.result.current.submitConnection({
      connectionId: "c1",
      connectionString: "127.0.0.1:2181",
      username: "",
      password: "",
    });
  });
  return hook;
}

describe("openNode", () => {
  it("fetches node details and updates activePath", async () => {
    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.openNode("/configs");
    });

    await waitFor(() => {
      expect(result.current.activePath).toBe("/configs");
      expect(result.current.activeNode?.path).toBe("/configs");
    });
  });

  it("does nothing when no session is active", async () => {
    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.openNode("/configs");
    });
    expect(result.current.activePath).toBeNull();
  });
});

describe("draft management", () => {
  it("updateDraft and discardDraft modify drafts for current session", async () => {
    const { result } = await connectAndGet();

    act(() => {
      result.current.updateDraft("/configs", "edited");
    });
    expect(result.current.drafts["/configs"]).toBe("edited");

    act(() => {
      result.current.discardDraft("/configs");
    });
    expect(result.current.drafts["/configs"]).toBeUndefined();
  });
});

describe("parser plugin contracts", () => {
  it("constructs parser plugin types for the editor flow", () => {
    const plugin: ParserPlugin = { id: "dubbo-provider", name: "Dubbo Provider Decoder" };
    const result: ParserPluginResult = {
      pluginId: "dubbo-provider",
      pluginName: "Dubbo Provider Decoder",
      content: "decoded output",
      generatedAt: 1,
    };

    expectTypeOf(plugin).toMatchTypeOf<ParserPlugin>();
    expectTypeOf(result).toMatchTypeOf<ParserPluginResult>();
    expect(plugin.name).toContain("Decoder");
    expect(result.content).toBe("decoded output");
  });

  it("exposes parser plugin command wrappers for the editor flow", () => {
    expect(commands.listParserPlugins).toBeTypeOf("function");
    expect(commands.runParserPlugin).toBeTypeOf("function");
  });
});
