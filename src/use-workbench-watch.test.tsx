import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import type { SavedConnection, WatchEvent } from "./lib/types";

const {
  listChildrenMock,
  getNodeDetailsMock,
  loadFullTreeMock,
  listenMock,
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
    listenMock: vi.fn(async (_eventName: string, cb: typeof handler) => {
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
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

    expect(listenMock).toHaveBeenCalledWith("zk-watch-event", expect.any(Function));

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
});
