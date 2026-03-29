import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import type { SavedConnection, WatchEvent } from "./lib/types";

const {
  listChildrenMock,
  getNodeDetailsMock,
  loadFullTreeMock,
  webviewListenMock,
  unlistenMock,
  emitWatchEvent,
} = vi.hoisted(() => {
  const unlistenMock = vi.fn();
  let handler:
    | ((event: { payload: { connectionId: string; eventType: string; path: string } }) => void)
    | null = null;

  return {
    listChildrenMock: vi.fn(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/configs", name: "configs", hasChildren: true }];
      }
      if (path === "/configs") {
        return [{ path: "/configs/feature-a", name: "feature-a", hasChildren: false }];
      }
      return [];
    }),
    getNodeDetailsMock: vi.fn(async (_connectionId: string, path: string) => ({
      path,
      value: "value-v1",
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
      dataLength: 8,
      ephemeral: false,
    })),
    loadFullTreeMock: vi.fn(async () => []),
    webviewListenMock: vi.fn(async (_eventName: string, cb: typeof handler) => {
      handler = cb;
      return unlistenMock;
    }),
    unlistenMock,
    emitWatchEvent: async (payload: WatchEvent) => {
      handler?.({ payload });
      await Promise.resolve();
    },
  };
});

vi.mock("./lib/commands", () => ({
  connectServer: vi.fn(async () => ({
    connected: true,
    authMode: "anonymous",
    authSucceeded: true,
    message: "",
  })),
  disconnectServer: vi.fn(async () => {}),
  listChildren: listChildrenMock,
  getNodeDetails: getNodeDetailsMock,
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
  loadFullTree: loadFullTreeMock,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: webviewListenMock,
  }),
}));

const CONN: SavedConnection = {
  id: "c1",
  name: "本地",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

async function connectAndGet() {
  const hook = renderHook(() => useWorkbenchState());
  await act(async () => {
    await hook.result.current.submitConnection({
      connectionId: "c1",
      connectionString: CONN.connectionString,
      username: "",
      password: "",
    });
  });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("zoocute:connections", JSON.stringify([CONN]));
});

describe("watch events", () => {
  it("registers a watch listener on connect and unregisters it on disconnect", async () => {
    const { result } = await connectAndGet();

    expect(webviewListenMock).toHaveBeenCalledWith("zk-watch-event", expect.any(Function));

    await act(async () => {
      await result.current.disconnectSession("c1");
    });

    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  it("force-refreshes children when a children_changed event arrives", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/configs", name: "configs", hasChildren: true }];
      }
      if (path === "/configs") {
        return [{ path: "/configs/feature-b", name: "feature-b", hasChildren: false }];
      }
      return [];
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/configs",
      });
    });

    await waitFor(() => {
      const configs = result.current.treeNodes.find((node) => node.path === "/configs");
      expect(configs?.children?.map((child) => child.name)).toEqual(["feature-b"]);
    });

    act(() => {
      result.current.setSearchQuery("feature-b");
    });

    await waitFor(() => {
      expect(result.current.searchResults.map((node) => node.path)).toContain("/configs/feature-b");
    });
  });

  it("refreshes the active node details on data_changed", async () => {
    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.openNode("/configs");
    });

    getNodeDetailsMock.mockResolvedValueOnce({
      path: "/configs",
      value: "value-v2",
      dataKind: "text",
      displayModeLabel: "文本 · 可编辑",
      editable: true,
      rawPreview: "",
      decodedPreview: "",
      version: 2,
      childrenCount: 0,
      updatedAt: "",
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      dataLength: 8,
      ephemeral: false,
    });

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "data_changed",
        path: "/configs",
      });
    });

    await waitFor(() => {
      expect(result.current.activeNode?.value).toBe("value-v2");
      expect(result.current.activeNode?.version).toBe(2);
    });
  });

  it("loads children when node details reveal descendants for a node previously marked as leaf", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/configs", name: "configs", hasChildren: false }];
      }
      if (path === "/configs") {
        return [{ path: "/configs/late-child", name: "late-child", hasChildren: false }];
      }
      return [];
    });

    getNodeDetailsMock.mockResolvedValueOnce({
      path: "/configs",
      value: "value-v1",
      dataKind: "text",
      displayModeLabel: "文本 · 可编辑",
      editable: true,
      rawPreview: "",
      decodedPreview: "",
      version: 1,
      childrenCount: 1,
      updatedAt: "",
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      dataLength: 8,
      ephemeral: false,
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.openNode("/configs");
    });

    await waitFor(() => {
      const configs = result.current.treeNodes.find((node) => node.path === "/configs");
      expect(configs?.children?.map((child) => child.name)).toEqual(["late-child"]);
      expect(result.current.expandedPaths.has("/configs")).toBe(true);
    });
  });

  it("marks a newly recreated node as expandable after parent refresh without requiring openNode", async () => {
    let phase = 0;
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/services", name: "services", hasChildren: true }];
      }
      if (path === "/services") {
        if (phase === 0) {
          phase = 1;
          return [];
        }
        return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
      }
      return [];
    });

    getNodeDetailsMock.mockResolvedValue({
      path: "/services/bbp",
      value: "v1",
      dataKind: "text",
      displayModeLabel: "文本 · 可编辑",
      editable: true,
      rawPreview: "",
      decodedPreview: "",
      version: 1,
      childrenCount: 2,
      updatedAt: "",
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      dataLength: 0,
      ephemeral: false,
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.ensureChildrenLoaded("/services");
    });

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((node) => node.path === "/services");
      const bbp = services?.children?.find((node) => node.path === "/services/bbp");
      expect(bbp?.hasChildren).toBe(true);
    });
  });

  it("probes newly discovered children after a parent refresh and marks them expandable", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/services", name: "services", hasChildren: true }];
      }
      if (path === "/services") {
        return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
      }
      return [];
    });

    getNodeDetailsMock.mockResolvedValue({
      path: "/services/bbp",
      value: "v1",
      dataKind: "text",
      displayModeLabel: "文本 · 可编辑",
      editable: true,
      rawPreview: "",
      decodedPreview: "",
      version: 1,
      childrenCount: 3,
      updatedAt: "",
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      dataLength: 0,
      ephemeral: false,
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    await waitFor(() => {
      expect(getNodeDetailsMock).toHaveBeenCalledWith("c1", "/services/bbp");
      const services = result.current.treeNodes.find((node) => node.path === "/services");
      expect(services?.children?.[0]?.hasChildren).toBe(true);
    });
  });

  it("silently ignores NoNode errors during probe and still marks other new nodes expandable", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") return [{ path: "/services", name: "services", hasChildren: true }];
      if (path === "/services") return [
        { path: "/services/gone", name: "gone", hasChildren: false },
        { path: "/services/bbp", name: "bbp", hasChildren: false },
      ];
      return [];
    });

    getNodeDetailsMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/services/gone") throw new Error("NoNode");
      return {
        path,
        value: "v1",
        dataKind: "text",
        displayModeLabel: "文本 · 可编辑",
        editable: true,
        rawPreview: "",
        decodedPreview: "",
        version: 1,
        childrenCount: 3,
        updatedAt: "",
        cVersion: 0,
        aclVersion: 0,
        cZxid: null,
        mZxid: null,
        cTime: 0,
        mTime: 0,
        dataLength: 0,
        ephemeral: false,
      };
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((n) => n.path === "/services");
      const bbp = services?.children?.find((n) => n.path === "/services/bbp");
      // gone was NoNode — no error surfaced
      expect(result.current.connectionError).toBeNull();
      // bbp was successfully probed
      expect(bbp?.hasChildren).toBe(true);
    });
  });

  it("re-probes freshly added nodes when descendants arrive shortly after the parent node", async () => {
    vi.useFakeTimers();
    let detailsCalls = 0;
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/services", name: "services", hasChildren: true }];
      }
      if (path === "/services") {
        return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
      }
      return [];
    });

    getNodeDetailsMock.mockImplementation(async () => {
      detailsCalls += 1;
      return {
        path: "/services/bbp",
        value: "v1",
        dataKind: "text",
        displayModeLabel: "文本 · 可编辑",
        editable: true,
        rawPreview: "",
        decodedPreview: "",
        version: 1,
        childrenCount: detailsCalls === 1 ? 0 : 2,
        updatedAt: "",
        cVersion: 0,
        aclVersion: 0,
        cZxid: null,
        mZxid: null,
        cTime: 0,
        mTime: 0,
        dataLength: 0,
        ephemeral: false,
      };
    });

    const { result } = await connectAndGet();

    // First event: bbp appears, first probe returns childrenCount=0 -> enters observation window
    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    // Advance time within window, second event triggers re-probe
    await act(async () => {
      vi.advanceTimersByTime(500);
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((node) => node.path === "/services");
      expect(services?.children?.[0]?.hasChildren).toBe(true);
    });

    vi.useRealTimers();
  });

  it("does not re-probe after the observation window expires", async () => {
    vi.useFakeTimers();
    let detailsCalls = 0;
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") return [{ path: "/services", name: "services", hasChildren: true }];
      if (path === "/services") return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
      return [];
    });

    getNodeDetailsMock.mockImplementation(async () => {
      detailsCalls += 1;
      return {
        path: "/services/bbp", value: "v1", dataKind: "text",
        displayModeLabel: "文本 · 可编辑", editable: true,
        rawPreview: "", decodedPreview: "", version: 1,
        childrenCount: detailsCalls === 1 ? 0 : 2,
        updatedAt: "", cVersion: 0, aclVersion: 0,
        cZxid: null, mZxid: null, cTime: 0, mTime: 0, dataLength: 0, ephemeral: false,
      };
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({ connectionId: "c1", eventType: "children_changed", path: "/services" });
    });

    // Advance past window (> 1500ms)
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await emitWatchEvent({ connectionId: "c1", eventType: "children_changed", path: "/services" });
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((node) => node.path === "/services");
      // Window expired — no re-probe, bbp stays as leaf
      expect(services?.children?.[0]?.hasChildren).toBe(false);
    });

    expect(getNodeDetailsMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("syncs search cache hasChildren when probe marks a node as expandable", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") return [{ path: "/services", name: "services", hasChildren: true }];
      if (path === "/services") return [{ path: "/services/bbp", name: "bbp", hasChildren: false }];
      return [];
    });

    getNodeDetailsMock.mockResolvedValue({
      path: "/services/bbp",
      value: "v1",
      dataKind: "text",
      displayModeLabel: "文本 · 可编辑",
      editable: true,
      rawPreview: "",
      decodedPreview: "",
      version: 1,
      childrenCount: 3,
      updatedAt: "",
      cVersion: 0,
      aclVersion: 0,
      cZxid: null,
      mZxid: null,
      cTime: 0,
      mTime: 0,
      dataLength: 2,
      ephemeral: false,
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/services",
      });
    });

    await waitFor(() => {
      // Tree must be patched
      const services = result.current.treeNodes.find((n) => n.path === "/services");
      expect(services?.children?.[0]?.hasChildren).toBe(true);
    });

    // Search cache must also be in sync
    act(() => { result.current.setSearchQuery("bbp"); });

    await waitFor(() => {
      const bbpResult = result.current.searchResults.find((r) => r.path === "/services/bbp");
      expect(bbpResult).toBeDefined();
      expect(bbpResult?.hasChildren).toBe(true);
    });
  });

  it("removes a deleted node, clears the active panel, and refreshes the parent", async () => {
    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.openNode("/configs");
    });

    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") return [];
      return [];
    });

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "node_deleted",
        path: "/configs",
      });
    });

    await waitFor(() => {
      expect(result.current.treeNodes.find((node) => node.path === "/configs")).toBeUndefined();
      expect(result.current.activePath).toBeNull();
      expect(result.current.activeNode).toBeNull();
    });

    expect(listChildrenMock).toHaveBeenCalledWith("c1", "/");
  });

  it("treats NoNode during forced child refresh as a delete instead of surfacing an error", async () => {
    let deleted = false;
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return deleted ? [] : [{ path: "/configs", name: "configs", hasChildren: true }];
      }
      if (path === "/configs") {
        deleted = true;
        throw new Error("NoNode");
      }
      return [];
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/configs",
      });
    });

    await waitFor(() => {
      expect(result.current.treeNodes.find((node) => node.path === "/configs")).toBeUndefined();
    });

    expect(result.current.connectionError).toBeNull();
    expect(listChildrenMock).toHaveBeenCalledWith("c1", "/");
  });

  it("coalesces repeated children_changed events for the same path while a refresh is in flight", async () => {
    let release: (() => void) | null = null;
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/") {
        return [{ path: "/configs", name: "configs", hasChildren: true }];
      }
      if (path === "/configs") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [{ path: "/configs/feature-c", name: "feature-c", hasChildren: false }];
      }
      return [];
    });

    const { result } = await connectAndGet();

    const event = {
      connectionId: "c1" as const,
      eventType: "children_changed" as const,
      path: "/configs",
    };

    await act(async () => {
      const first = emitWatchEvent(event);
      const second = emitWatchEvent(event);
      await Promise.resolve();
      release?.();
      await Promise.all([first, second]);
    });

    await waitFor(() => {
      const configs = result.current.treeNodes.find((node) => node.path === "/configs");
      expect(configs?.children?.map((child) => child.name)).toEqual(["feature-c"]);
    });

    expect(
      listChildrenMock.mock.calls.filter(([, path]) => path === "/configs")
    ).toHaveLength(1);
  });
});
