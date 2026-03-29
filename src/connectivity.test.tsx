import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import type { SavedConnection } from "./lib/types";

const {
  connectServerMock,
  disconnectServerMock,
  listChildrenMock,
  getNodeDetailsMock,
} = vi.hoisted(() => ({
  connectServerMock: vi.fn(async () => ({
    connected: true,
    authMode: "digest",
    authSucceeded: true,
    message: "connected to 127.0.0.1:2181",
  })),
  disconnectServerMock: vi.fn(async () => {}),
  listChildrenMock: vi.fn(async (_connectionId: string, path: string) => {
    if (path === "/") {
      return [{ path: "/services", name: "services", hasChildren: true }];
    }
    if (path === "/services") {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      return [{ path: "/services/gateway", name: "gateway", hasChildren: false }];
    }
    return [];
  }),
  getNodeDetailsMock: vi.fn(async (_connectionId: string, path: string) => ({
    path,
    value: "gateway_enabled=true",
    formatHint: "text",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 7,
    childrenCount: 0,
    updatedAt: "2026-03-28 11:00",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    dataLength: 20,
    ephemeral: false,
  })),
}));

vi.mock("./lib/commands", () => ({
  connectServer: connectServerMock,
  disconnectServer: disconnectServerMock,
  listChildren: listChildrenMock,
  getNodeDetails: getNodeDetailsMock,
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
  loadFullTree: vi.fn(async () => []),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(async () => vi.fn()),
  }),
}));

const LOCAL_CONN: SavedConnection = {
  id: "local",
  name: "本地开发",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("zoocute:connections", JSON.stringify([LOCAL_CONN]));
});

describe("submitConnection", () => {
  it("creates a session and switches to browse mode", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    expect(result.current.hasActiveSessions).toBe(true);
    expect(result.current.activeTabId).toBe("local");
    expect(result.current.ribbonMode).toBe("browse");
    expect(result.current.treeNodes.some((n) => n.name === "services")).toBe(true);
  });

  it("sets connectionError on failure", async () => {
    connectServerMock.mockRejectedValueOnce(new Error("refused"));
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "bad:2181",
        username: "",
        password: "",
      });
    });

    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.connectionError).toBe("refused");
  });
});

describe("testConnection", () => {
  it("checks connectivity without creating a session or switching to browse mode", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.testConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    expect(connectServerMock).toHaveBeenCalledWith("local", {
      connectionString: "127.0.0.1:2181",
      username: undefined,
      password: undefined,
    });
    expect(disconnectServerMock).toHaveBeenCalledWith("local");
    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.activeTabId).toBe(null);
    expect(result.current.ribbonMode).toBe("connections");
    expect(result.current.connectionError).toBe(null);
    expect(result.current.connectionNotice).toBe("连接测试成功");
  });
});

describe("toggleNode / lazy loading", () => {
  it("loads children when a node is expanded", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    await act(async () => {
      await result.current.toggleNode("/services");
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((n) => n.path === "/services");
      expect(services?.children?.some((c) => c.name === "gateway")).toBe(true);
    });
  });

  it("collapses an expanded node without re-fetching", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    await act(async () => {
      await result.current.toggleNode("/services");
    });

    await waitFor(() => {
      expect(result.current.expandedPaths.has("/services")).toBe(true);
    });

    await act(async () => {
      await result.current.toggleNode("/services");
    });

    expect(result.current.expandedPaths.has("/services")).toBe(false);
  });
});

describe("disconnectSession", () => {
  it("removes the session and reverts to connections mode", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    await act(async () => {
      await result.current.disconnectSession("local");
    });

    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.ribbonMode).toBe("connections");
  });
});
