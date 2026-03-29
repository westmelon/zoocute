import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useSessionManager } from "./hooks/use-session-manager";
import type { SavedConnection, NodeTreeItem } from "./lib/types";

const conn: SavedConnection = {
  id: "c1",
  name: "本地开发",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

const rootNodes: NodeTreeItem[] = [
  { path: "/configs", name: "configs", hasChildren: true },
];

describe("useSessionManager", () => {
  it("starts with no sessions and no active tab", () => {
    const { result } = renderHook(() => useSessionManager());
    expect(result.current.sessions.size).toBe(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.hasActiveSessions).toBe(false);
  });

  it("addSession creates a session and sets it as the active tab", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    expect(result.current.sessions.size).toBe(1);
    expect(result.current.activeTabId).toBe("c1");
    expect(result.current.hasActiveSessions).toBe(true);
    expect(result.current.sessions.get("c1")?.treeNodes).toEqual(rootNodes);
  });

  it("removeSession deletes the session and clears activeTabId when last", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    act(() => {
      result.current.removeSession("c1");
    });
    expect(result.current.sessions.size).toBe(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.hasActiveSessions).toBe(false);
  });

  it("removeSession switches to another tab if available", () => {
    const conn2: SavedConnection = { id: "c2", name: "生产", connectionString: "prod:2181", timeoutMs: 5000 };
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
      result.current.addSession(conn2, []);
    });
    act(() => {
      result.current.removeSession("c2");
    });
    expect(result.current.activeTabId).toBe("c1");
  });

  it("updateSession mutates only the target session", () => {
    const conn2: SavedConnection = { id: "c2", name: "生产", connectionString: "prod:2181", timeoutMs: 5000 };
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
      result.current.addSession(conn2, []);
    });
    act(() => {
      result.current.updateSession("c1", (s) => ({ ...s, activePath: "/configs" }));
    });
    expect(result.current.sessions.get("c1")?.activePath).toBe("/configs");
    expect(result.current.sessions.get("c2")?.activePath).toBeNull();
  });

  it("enterEditMode adds path to editingPaths", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    act(() => {
      result.current.enterEditMode("c1", "/configs");
    });
    expect(result.current.sessions.get("c1")?.editingPaths.has("/configs")).toBe(true);
  });

  it("exitEditMode removes path from editingPaths", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    act(() => {
      result.current.enterEditMode("c1", "/configs");
    });
    act(() => {
      result.current.exitEditMode("c1", "/configs");
    });
    expect(result.current.sessions.get("c1")?.editingPaths.has("/configs")).toBe(false);
  });

  it("enterEditMode on unknown connectionId is a no-op", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    act(() => {
      result.current.enterEditMode("unknown-id", "/configs");
    });
    // sessions map is unchanged; existing session is unaffected
    expect(result.current.sessions.size).toBe(1);
    expect(result.current.sessions.get("c1")?.editingPaths.size).toBe(0);
  });
});
