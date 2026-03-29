import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { usePersistedConnections } from "./hooks/use-persisted-connections";
import type { SavedConnection } from "./lib/types";

const CONN_KEY = "zoocute:connections";
const SEL_KEY = "zoocute:selected-connection";

const defaultConn: SavedConnection = {
  id: "local",
  name: "本地开发",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

beforeEach(() => {
  localStorage.clear();
});

describe("usePersistedConnections", () => {
  it("returns default connection when localStorage is empty", () => {
    const { result } = renderHook(() => usePersistedConnections());
    expect(result.current.savedConnections).toEqual([defaultConn]);
    expect(result.current.selectedConnectionId).toBe("local");
  });

  it("restores connections from localStorage", () => {
    const stored: SavedConnection[] = [
      { id: "prod", name: "生产", connectionString: "10.0.0.1:2181", timeoutMs: 8000 },
    ];
    localStorage.setItem(CONN_KEY, JSON.stringify(stored));
    localStorage.setItem(SEL_KEY, "prod");

    const { result } = renderHook(() => usePersistedConnections());
    expect(result.current.savedConnections).toEqual(stored);
    expect(result.current.selectedConnectionId).toBe("prod");
  });

  it("persists connections to localStorage when updated", () => {
    const { result } = renderHook(() => usePersistedConnections());
    const newConns: SavedConnection[] = [
      { id: "stg", name: "预发", connectionString: "10.0.0.2:2181", timeoutMs: 5000 },
    ];
    act(() => result.current.setSavedConnections(newConns));
    expect(JSON.parse(localStorage.getItem(CONN_KEY)!)).toEqual(newConns);
  });

  it("persists selectedConnectionId to localStorage when updated", () => {
    const { result } = renderHook(() => usePersistedConnections());
    act(() => result.current.setSelectedConnectionId("stg"));
    expect(localStorage.getItem(SEL_KEY)).toBe("stg");
  });
});
