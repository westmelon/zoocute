# Connection Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist saved connections and the selected connection ID to localStorage so they survive app restarts.

**Architecture:** Extract a `usePersistedConnections` hook that reads from localStorage on mount and writes back whenever the state changes, following the same pattern as `usePanelResize`. `useWorkbenchState` delegates both `useState` calls to this hook.

**Tech Stack:** React, localStorage, Vitest, React Testing Library (`renderHook`)

---

## File Structure

- Create: `src/hooks/use-persisted-connections.ts` — hook that reads/writes connections + selectedId from localStorage
- Modify: `src/hooks/use-workbench-state.ts:96-99` — replace two raw `useState` calls with `usePersistedConnections()`
- Create: `src/persisted-connections.test.ts` — unit tests for the hook

Storage keys:
- `"zoocute:connections"` — JSON-serialized `SavedConnection[]`
- `"zoocute:selected-connection"` — string ID or empty string for null

---

### Task 1: usePersistedConnections hook

**Files:**
- Create: `src/hooks/use-persisted-connections.ts`
- Create: `src/persisted-connections.test.ts`
- Modify: `src/hooks/use-workbench-state.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/persisted-connections.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/persisted-connections.test.ts 2>&1
```

Expected: FAIL — `usePersistedConnections` not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/use-persisted-connections.ts`:

```ts
import { useState, useEffect, Dispatch, SetStateAction } from "react";
import type { SavedConnection } from "../lib/types";

const CONN_KEY = "zoocute:connections";
const SEL_KEY = "zoocute:selected-connection";

const DEFAULT_CONNECTIONS: SavedConnection[] = [
  { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
];

function loadConnections(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    if (raw) return JSON.parse(raw) as SavedConnection[];
  } catch {
    // ignore malformed data
  }
  return DEFAULT_CONNECTIONS;
}

function loadSelectedId(): string | null {
  const raw = localStorage.getItem(SEL_KEY);
  if (raw === null) return "local";
  return raw || null;
}

export function usePersistedConnections(): {
  savedConnections: SavedConnection[];
  setSavedConnections: Dispatch<SetStateAction<SavedConnection[]>>;
  selectedConnectionId: string | null;
  setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
} {
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>(loadConnections);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(loadSelectedId);

  useEffect(() => {
    localStorage.setItem(CONN_KEY, JSON.stringify(savedConnections));
  }, [savedConnections]);

  useEffect(() => {
    localStorage.setItem(SEL_KEY, selectedConnectionId ?? "");
  }, [selectedConnectionId]);

  return { savedConnections, setSavedConnections, selectedConnectionId, setSelectedConnectionId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/persisted-connections.test.ts 2>&1
```

Expected: 4 tests PASS.

- [ ] **Step 5: Wire into useWorkbenchState**

In `src/hooks/use-workbench-state.ts`, replace the two raw `useState` calls for connections:

Remove these lines (around line 96–99):
```ts
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([
    { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
  ]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>("local");
```

Replace with:
```ts
  const {
    savedConnections, setSavedConnections,
    selectedConnectionId, setSelectedConnectionId,
  } = usePersistedConnections();
```

Also add the import at the top of the file (after the existing imports):
```ts
import { usePersistedConnections } from "./use-persisted-connections";
```

- [ ] **Step 6: Run all tests to verify nothing broke**

```bash
npm test -- --run 2>&1
```

Expected: all tests pass (previous count + 4 new).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-persisted-connections.ts src/persisted-connections.test.ts src/hooks/use-workbench-state.ts
git commit -m "feat: persist saved connections and selected ID to localStorage"
```
