import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { getTreeSnapshot } from "./lib/commands";
import type { SavedConnection } from "./lib/types";

const {
  connectServerMock,
  disconnectServerMock,
  listChildrenMock,
  getNodeDetailsMock,
  getTreeSnapshotMock,
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
  getTreeSnapshotMock: vi.fn(async () => ({
    status: "live",
    nodes: [{ path: "/services", name: "services", parentPath: "/", hasChildren: true }],
  })),
}));

vi.mock("./lib/commands", () => ({
  connectServer: connectServerMock,
  disconnectServer: disconnectServerMock,
  listChildren: listChildrenMock,
  getNodeDetails: getNodeDetailsMock,
  getTreeSnapshot: getTreeSnapshotMock,
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

const AUTH_HINT =
  "\u8ba4\u8bc1\u5931\u8d25\uff1a\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\uff0c\u6216\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u8bbf\u95ee\u6839\u8282\u70b9\u7684\u6743\u9650\u3002\u8bf7\u68c0\u67e5\u7528\u6237\u540d\u3001\u5bc6\u7801\uff0c\u5e76\u786e\u8ba4\u5df2\u4fdd\u5b58\u6700\u65b0\u914d\u7f6e\u3002";

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

  it("loads tree snapshot after connection without switching tree rendering source", async () => {
    getTreeSnapshotMock.mockResolvedValue({
      status: "live",
      nodes: [
        { path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true },
        {
          path: "/ssdev/services",
          name: "services",
          parentPath: "/ssdev",
          hasChildren: true,
        },
      ],
    });

    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    expect(getTreeSnapshotMock).toHaveBeenCalledWith("local");
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

  it("exposes a pending connect state while the connection request is in flight", async () => {
    let release: (() => void) | null = null;
    connectServerMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              connected: true,
              authMode: "digest",
              authSucceeded: true,
              message: "connected to 127.0.0.1:2181",
            });
        })
    );

    const { result } = renderHook(() => useWorkbenchState());

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
      await Promise.resolve();
    });

    expect(result.current.isConnecting).toBe(true);
    expect(result.current.connectionAction).toBe("connect");
    expect(result.current.pendingConnectionId).toBe("local");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.isConnecting).toBe(false);
    expect(result.current.connectionAction).toBeNull();
    expect(result.current.pendingConnectionId).toBeNull();
  });

  it("shows an explicit auth hint when the root load is rejected with NoAuth", async () => {
    listChildrenMock.mockRejectedValueOnce(new Error("NoAuth"));
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "admin",
        password: "bad-password",
      });
    });

    expect(result.current.hasActiveSessions).toBe(false);
    expect(disconnectServerMock).toHaveBeenCalledWith("local");
    expect(result.current.connectionError).toBe(AUTH_HINT);
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
    expect(listChildrenMock).toHaveBeenCalledWith("local", "/");
    expect(disconnectServerMock).toHaveBeenCalledWith("local");
    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.activeTabId).toBe(null);
    expect(result.current.ribbonMode).toBe("connections");
    expect(result.current.connectionError).toBe(null);
    expect(result.current.connectionNotice).toBe("连接测试成功");
  });

  it("shows an explicit auth hint when the test connection returns NoAuth", async () => {
    listChildrenMock.mockRejectedValueOnce(new Error("NoAuth"));
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.testConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "admin",
        password: "bad-password",
      });
    });

    expect(disconnectServerMock).toHaveBeenCalledWith("local");
    expect(result.current.connectionError).toBe(AUTH_HINT);
  });

  it("exposes a pending test state while the test request is in flight", async () => {
    let release: (() => void) | null = null;
    connectServerMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              connected: true,
              authMode: "digest",
              authSucceeded: true,
              message: "connected to 127.0.0.1:2181",
            });
        })
    );

    const { result } = renderHook(() => useWorkbenchState());

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.testConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
      await Promise.resolve();
    });

    expect(result.current.isConnecting).toBe(true);
    expect(result.current.connectionAction).toBe("test");
    expect(result.current.pendingConnectionId).toBe("local");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.isConnecting).toBe(false);
    expect(result.current.connectionAction).toBeNull();
    expect(result.current.pendingConnectionId).toBeNull();
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
      expect(result.current.expandedPaths.has("/services")).toBe(true);
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

describe("getTreeSnapshot", () => {
  it("requests a tree snapshot for the active connection", async () => {
    getTreeSnapshotMock.mockResolvedValue({
      status: "live",
      nodes: [{ path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true }],
    });

    const snapshot = await getTreeSnapshot("local");
    expect(snapshot.status).toBe("live");
    expect(snapshot.nodes[0].path).toBe("/ssdev");
  });
});

