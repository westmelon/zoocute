import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { buildProjectedTree } from "./hooks/use-tree-projection";
import type {
  CacheEvent,
  NodeTreeItem,
  SavedConnection,
  TreeSnapshot,
  WatchEvent,
} from "./lib/types";

type WatchHandler = (event: { payload: WatchEvent }) => void;
type CacheHandler = (event: { payload: CacheEvent }) => void;

const {
  listChildrenMock,
  getNodeDetailsMock,
  getTreeSnapshotMock,
  loadFullTreeMock,
  webviewListenMock,
  unlistenMock,
  emitWatchEvent,
  emitCacheEvent,
} = vi.hoisted(() => {
  const unlistenMock = vi.fn();
  const handlers = new Map<string, unknown>();
  let treeSnapshot: TreeSnapshot = {
    status: "live" as const,
    nodes: [{ path: "/configs", name: "configs", parentPath: "/", hasChildren: true }],
  };

  function applyCacheEvent(payload: {
    eventType: string;
    parentPath: string | null;
    paths: string[];
  }) {
    if (payload.eventType !== "nodes_added") return;
    if (payload.parentPath !== "/ssdev/services") return;

    treeSnapshot = {
      ...treeSnapshot,
      nodes: [
        { path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true },
        {
          path: "/ssdev/services",
          name: "services",
          parentPath: "/ssdev",
          hasChildren: true,
        },
        {
          path: "/ssdev/services/bbp",
          name: "bbp",
          parentPath: "/ssdev/services",
          hasChildren: true,
        },
        {
          path: "/ssdev/services/bbp/detail",
          name: "detail",
          parentPath: "/ssdev/services/bbp",
          hasChildren: false,
        },
      ],
    };
  }

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
    getTreeSnapshotMock: vi.fn(async () => treeSnapshot),
    loadFullTreeMock: vi.fn(async () => []),
    webviewListenMock: vi.fn(async (_eventName: string, cb: WatchHandler | CacheHandler) => {
      handlers.set(_eventName, cb);
      return unlistenMock;
    }),
    unlistenMock,
    emitWatchEvent: async (payload: WatchEvent) => {
      (handlers.get("zk-watch-event") as WatchHandler | undefined)?.({ payload });
      await Promise.resolve();
    },
    emitCacheEvent: async (payload: {
      connectionId: string;
      eventType: string;
      parentPath: string | null;
      paths: string[];
    }) => {
      applyCacheEvent(payload);
      (handlers.get("zk-cache-event") as CacheHandler | undefined)?.({
        payload: payload as CacheEvent,
      });
      await Promise.resolve();
    },
  };
});

function findTreeNode(nodes: NodeTreeItem[], targetPath: string): NodeTreeItem | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    const found = node.children ? findTreeNode(node.children, targetPath) : undefined;
    if (found) return found;
  }
  return undefined;
}

async function expandPath(result: { current: ReturnType<typeof useWorkbenchState> }, path: string) {
  await act(async () => {
    await result.current.toggleNode(path);
  });
  await waitFor(() => {
    expect(result.current.expandedPaths.has(path)).toBe(true);
  });
}

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
  getTreeSnapshot: getTreeSnapshotMock,
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
    expect(webviewListenMock).toHaveBeenCalledWith("zk-cache-event", expect.any(Function));

    await act(async () => {
      await result.current.disconnectSession("c1");
    });

    expect(unlistenMock).toHaveBeenCalledTimes(2);
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

    await expandPath(result, "/configs");

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

  it("does not recursively project collapsed branches from a cache delta", async () => {
    const { result } = await connectAndGet();

    await act(async () => {
      await emitCacheEvent({
        connectionId: "c1",
        eventType: "nodes_added",
        parentPath: "/ssdev/services",
        paths: ["/ssdev/services/bbp", "/ssdev/services/bbp/detail"],
      });
    });

    await waitFor(() => {
      const ssdev = findTreeNode(result.current.treeNodes, "/ssdev");
      expect(ssdev).toBeDefined();
      expect(ssdev?.children).toBeUndefined();
      expect(findTreeNode(result.current.treeNodes, "/ssdev/services/bbp/detail")).toBeUndefined();
    });
  });

  it("falls back to activeSession.treeNodes while the first snapshot is still pending", async () => {
    getTreeSnapshotMock.mockImplementationOnce(
      () =>
        new Promise<TreeSnapshot>(() => {
          // keep the snapshot pending so the render path must use activeSession.treeNodes
        })
    );

    const { result } = await connectAndGet();

    expect(result.current.treeNodes.some((n) => n.path === "/configs")).toBe(true);
    expect(result.current.treeNodes.some((n) => n.path === "/ssdev")).toBe(false);
  });

  it("exposes cache status as a read-only ui signal", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    expect(result.current.cacheStatus).toBe("stale");

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "c1",
        connectionString: CONN.connectionString,
        username: "",
        password: "",
      });
    });

    await waitFor(() => {
      expect(result.current.cacheStatus).toBe("live");
    });
  });

  it("replaces a resyncing snapshot with a newer live snapshot even when node counts match", async () => {
    const { result } = await connectAndGet();

    expect(result.current.cacheStatus).toBe("live");

    getTreeSnapshotMock.mockResolvedValueOnce({
      status: "resyncing",
      nodes: [{ path: "/configs", name: "configs", parentPath: "/", hasChildren: true }],
    });

    await act(async () => {
      await emitCacheEvent({
        connectionId: "c1",
        eventType: "nodes_added",
        parentPath: "/",
        paths: [],
      });
    });

    await waitFor(() => {
      expect(result.current.cacheStatus).toBe("resyncing");
    });

    getTreeSnapshotMock.mockResolvedValueOnce({
      status: "live",
      nodes: [{ path: "/configs", name: "configs", parentPath: "/", hasChildren: true }],
    });

    await act(async () => {
      await emitCacheEvent({
        connectionId: "c1",
        eventType: "nodes_added",
        parentPath: "/",
        paths: [],
      });
    });

    await waitFor(() => {
      expect(result.current.cacheStatus).toBe("live");
    });
  });

  it("hides descendants of a collapsed child when projecting a nested snapshot", () => {
    const snapshot: TreeSnapshot = {
      status: "live",
      nodes: [
        { path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true },
        { path: "/ssdev/services", name: "services", parentPath: "/ssdev", hasChildren: true },
        {
          path: "/ssdev/services/bbp",
          name: "bbp",
          parentPath: "/ssdev/services",
          hasChildren: true,
        },
        {
          path: "/ssdev/services/bbp/detail",
          name: "detail",
          parentPath: "/ssdev/services/bbp",
          hasChildren: false,
        },
      ],
    };

    const projected = buildProjectedTree(snapshot, new Set(["/ssdev"]));
    const ssdev = projected.find((node) => node.path === "/ssdev");
    const services = ssdev?.children?.find((node) => node.path === "/ssdev/services");

    expect(ssdev?.children?.some((node) => node.path === "/ssdev/services")).toBe(true);
    expect(services?.children?.some((node) => node.path === "/ssdev/services/bbp")).toBeUndefined();
    expect(projected.some((node) => node.path === "/ssdev/services/bbp/detail")).toBe(false);
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

  it("does not rely on leaf reprobe timers once cache projection is active", async () => {
    listChildrenMock.mockImplementation(async (_connectionId: string, path: string) => {
      if (path === "/ssdev") {
        return [{ path: "/ssdev/services", name: "services", hasChildren: true }];
      }
      if (path === "/ssdev/services") {
        return [{ path: "/ssdev/services/bbp", name: "bbp", hasChildren: true }];
      }
      return [];
    });

    const { result } = await connectAndGet();

    await act(async () => {
      await emitCacheEvent({
        connectionId: "c1",
        eventType: "nodes_added",
        parentPath: "/ssdev/services",
        paths: ["/ssdev/services/bbp"],
      });
    });

    await expandPath(result, "/ssdev");
    await expandPath(result, "/ssdev/services");

    await act(async () => {
      await emitWatchEvent({
        connectionId: "c1",
        eventType: "children_changed",
        path: "/ssdev/services",
      });
    });

    await waitFor(() => {
      const services = findTreeNode(result.current.treeNodes, "/ssdev/services");
      expect(services?.children?.some((n) => n.path === "/ssdev/services/bbp")).toBe(true);
    });

    expect(getNodeDetailsMock).not.toHaveBeenCalled();
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

    await expandPath(result, "/configs");

    await waitFor(() => {
      const configs = result.current.treeNodes.find((node) => node.path === "/configs");
      expect(configs?.children?.map((child) => child.name)).toEqual(["feature-c"]);
    });

    expect(
      listChildrenMock.mock.calls.filter(([, path]) => path === "/configs")
    ).toHaveLength(1);
  });
});
