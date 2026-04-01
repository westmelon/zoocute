import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePersistedConnections } from "./hooks/use-persisted-connections";
import type { PersistedConnectionsDto, SavedConnection } from "./lib/types";

const { loadPersistedConnectionsMock, savePersistedConnectionsMock } = vi.hoisted(() => ({
  loadPersistedConnectionsMock: vi.fn(),
  savePersistedConnectionsMock: vi.fn(),
}));

vi.mock("./lib/commands", () => ({
  loadPersistedConnections: loadPersistedConnectionsMock,
  savePersistedConnections: savePersistedConnectionsMock,
}));

const CONN_KEY = "zoocute:connections";
const SEL_KEY = "zoocute:selected-connection";

const defaultConn: SavedConnection = {
  id: "local",
  name: "Local",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

const backendConnections: PersistedConnectionsDto = {
  savedConnections: [defaultConn],
  selectedConnectionId: "local",
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  loadPersistedConnectionsMock.mockResolvedValue({
    connections: backendConnections,
    status: { kind: "loaded", message: null },
  });
  savePersistedConnectionsMock.mockImplementation(async (payload) => payload);
});

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePersistedConnections", () => {
  it("loads persisted connections from the backend", async () => {
    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.savedConnections).toEqual([defaultConn]);
      expect(result.current.selectedConnectionId).toBe("local");
    });

    expect(loadPersistedConnectionsMock).toHaveBeenCalledTimes(1);
    expect(savePersistedConnectionsMock).not.toHaveBeenCalled();
  });

  it("persists connection updates through the backend after initial load", async () => {
    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.savedConnections).toEqual([defaultConn]);
    });

    const newConnections: SavedConnection[] = [
      { id: "stg", name: "Staging", connectionString: "10.0.0.2:2181", timeoutMs: 5000 },
    ];

    await act(async () => {
      result.current.setSavedConnections(newConnections);
    });

    await waitFor(() => {
      expect(savePersistedConnectionsMock).toHaveBeenCalledWith({
        savedConnections: newConnections,
        selectedConnectionId: "local",
      });
    });
  });

  it("persists selectedConnectionId updates through the backend after initial load", async () => {
    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("local");
    });

    await act(async () => {
      result.current.setSelectedConnectionId("other");
    });

    await waitFor(() => {
      expect(savePersistedConnectionsMock).toHaveBeenCalledWith({
        savedConnections: [defaultConn],
        selectedConnectionId: "other",
      });
    });
  });

  it("migrates legacy localStorage data into the backend when the backend is missing persisted data", async () => {
    const legacyConnections: SavedConnection[] = [
      { id: "prod", name: "Production", connectionString: "10.0.0.1:2181", timeoutMs: 8000 },
    ];
    localStorage.setItem(CONN_KEY, JSON.stringify(legacyConnections));
    localStorage.setItem(SEL_KEY, "prod");
    loadPersistedConnectionsMock.mockResolvedValueOnce({
      connections: backendConnections,
      status: { kind: "missing", message: null },
    });
    savePersistedConnectionsMock.mockResolvedValueOnce({
      savedConnections: legacyConnections,
      selectedConnectionId: "prod",
    });

    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(savePersistedConnectionsMock).toHaveBeenCalledWith({
        savedConnections: legacyConnections,
        selectedConnectionId: "prod",
      });
    });

    await waitFor(() => {
      expect(result.current.savedConnections).toEqual(legacyConnections);
      expect(result.current.selectedConnectionId).toBe("prod");
    });

    expect(localStorage.getItem(CONN_KEY)).toBeNull();
    expect(localStorage.getItem(SEL_KEY)).toBeNull();
  });

  it("does not overwrite backend state before the initial load resolves", async () => {
    let resolveLoad: ((value: unknown) => void) | undefined;
    loadPersistedConnectionsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );

    const { result } = renderHook(() => usePersistedConnections());

    act(() => {
      result.current.setSelectedConnectionId("prod");
    });

    expect(savePersistedConnectionsMock).not.toHaveBeenCalled();

    resolveLoad?.({
      connections: backendConnections,
      status: { kind: "loaded", message: null },
    });

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("local");
    });
  });

  it("does not let an older save response overwrite newer state when saves resolve out of order", async () => {
    const firstSave = createDeferred<PersistedConnectionsDto>();
    const secondSave = createDeferred<PersistedConnectionsDto>();
    savePersistedConnectionsMock
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("local");
    });

    await act(async () => {
      result.current.setSelectedConnectionId("stale");
      result.current.setSelectedConnectionId("fresh");
    });

    await waitFor(() => {
      expect(savePersistedConnectionsMock).toHaveBeenNthCalledWith(1, {
        savedConnections: [defaultConn],
        selectedConnectionId: "stale",
      });
      expect(savePersistedConnectionsMock).toHaveBeenNthCalledWith(2, {
        savedConnections: [defaultConn],
        selectedConnectionId: "fresh",
      });
    });

    await act(async () => {
      secondSave.resolve({
        savedConnections: [defaultConn],
        selectedConnectionId: "fresh",
      });
      await secondSave.promise;
    });

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("fresh");
    });

    await act(async () => {
      firstSave.resolve({
        savedConnections: [defaultConn],
        selectedConnectionId: "stale",
      });
      await firstSave.promise;
    });

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("fresh");
    });
  });

  it("keeps legacy localStorage data visible when migration save fails", async () => {
    const legacyConnections: SavedConnection[] = [
      { id: "prod", name: "Production", connectionString: "10.0.0.1:2181", timeoutMs: 8000 },
    ];
    localStorage.setItem(CONN_KEY, JSON.stringify(legacyConnections));
    localStorage.setItem(SEL_KEY, "prod");
    loadPersistedConnectionsMock.mockResolvedValueOnce({
      connections: backendConnections,
      status: { kind: "missing", message: null },
    });
    savePersistedConnectionsMock.mockRejectedValueOnce(new Error("disk full"));

    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.savedConnections).toEqual(legacyConnections);
      expect(result.current.selectedConnectionId).toBe("prod");
    });

    expect(localStorage.getItem(CONN_KEY)).toBe(JSON.stringify(legacyConnections));
    expect(localStorage.getItem(SEL_KEY)).toBe("prod");
  });

  it("rolls back to the last confirmed persisted state when the latest save fails", async () => {
    const confirmedConnections: PersistedConnectionsDto = {
      savedConnections: [defaultConn],
      selectedConnectionId: "local",
    };
    const failedSave = createDeferred<PersistedConnectionsDto>();
    savePersistedConnectionsMock.mockReturnValueOnce(failedSave.promise);

    const { result } = renderHook(() => usePersistedConnections());

    await waitFor(() => {
      expect(result.current.savedConnections).toEqual(confirmedConnections.savedConnections);
      expect(result.current.selectedConnectionId).toBe(confirmedConnections.selectedConnectionId);
    });

    await act(async () => {
      result.current.setSelectedConnectionId("prod");
    });

    expect(result.current.selectedConnectionId).toBe("prod");

    await act(async () => {
      failedSave.reject(new Error("write failed"));
      try {
        await failedSave.promise;
      } catch {
        // expected rejection
      }
    });

    await waitFor(() => {
      expect(result.current.selectedConnectionId).toBe("local");
      expect(result.current.savedConnections).toEqual(confirmedConnections.savedConnections);
    });
  });
});
