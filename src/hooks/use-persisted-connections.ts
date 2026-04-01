import { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import {
  loadPersistedConnections,
  savePersistedConnections,
} from "../lib/commands";
import type {
  PersistedConnectionsDto,
  SavedConnection,
} from "../lib/types";

const CONN_KEY = "zoocute:connections";
const SEL_KEY = "zoocute:selected-connection";

const DEFAULT_CONNECTIONS: SavedConnection[] = [
  { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
];

const DEFAULT_PERSISTED_CONNECTIONS: PersistedConnectionsDto = {
  savedConnections: DEFAULT_CONNECTIONS,
  selectedConnectionId: "local",
};

function loadLegacyConnections(): PersistedConnectionsDto | null {
  try {
    const rawConnections = localStorage.getItem(CONN_KEY);
    if (!rawConnections) return null;

    const savedConnections = JSON.parse(rawConnections) as SavedConnection[];
    if (!Array.isArray(savedConnections) || savedConnections.length === 0) {
      return null;
    }

    const rawSelectedId = localStorage.getItem(SEL_KEY);
    const selectedConnectionId =
      rawSelectedId && savedConnections.some((connection) => connection.id === rawSelectedId)
        ? rawSelectedId
        : savedConnections[0]?.id ?? null;

    return { savedConnections, selectedConnectionId };
  } catch {
    return null;
  }
}

function clearLegacyConnections() {
  localStorage.removeItem(CONN_KEY);
  localStorage.removeItem(SEL_KEY);
}

export function usePersistedConnections(): {
  savedConnections: SavedConnection[];
  setSavedConnections: Dispatch<SetStateAction<SavedConnection[]>>;
  selectedConnectionId: string | null;
  setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
} {
  const [savedConnections, setSavedConnectionsState] = useState<SavedConnection[]>(
    DEFAULT_PERSISTED_CONNECTIONS.savedConnections
  );
  const [selectedConnectionId, setSelectedConnectionIdState] = useState<string | null>(
    DEFAULT_PERSISTED_CONNECTIONS.selectedConnectionId
  );
  const hydratedRef = useRef(false);
  const latestRef = useRef<PersistedConnectionsDto>(DEFAULT_PERSISTED_CONNECTIONS);
  const confirmedRef = useRef<PersistedConnectionsDto>(DEFAULT_PERSISTED_CONNECTIONS);
  const saveVersionRef = useRef(0);

  function applyPersistedConnections(next: PersistedConnectionsDto) {
    latestRef.current = next;
    setSavedConnectionsState(next.savedConnections);
    setSelectedConnectionIdState(next.selectedConnectionId);
  }

  function applyConfirmedConnections(next: PersistedConnectionsDto) {
    confirmedRef.current = next;
    applyPersistedConnections(next);
  }

  function persistNext(next: PersistedConnectionsDto) {
    const requestVersion = ++saveVersionRef.current;
    latestRef.current = next;

    if (!hydratedRef.current) {
      return;
    }

    void savePersistedConnections(next)
      .then((persisted) => {
        if (requestVersion !== saveVersionRef.current) {
          return;
        }
        applyConfirmedConnections(persisted);
      })
      .catch(() => {
        if (requestVersion !== saveVersionRef.current) {
          return;
        }
        applyPersistedConnections(confirmedRef.current);
      });
  }

  useEffect(() => {
    latestRef.current = { savedConnections, selectedConnectionId };
  }, [savedConnections, selectedConnectionId]);

  useEffect(() => {
    let cancelled = false;

    void loadPersistedConnections()
      .then(async ({ connections, status }) => {
        if (cancelled) return;

        let nextConnections = connections;
        const legacyConnections = status.kind === "missing" ? loadLegacyConnections() : null;

        if (legacyConnections) {
          try {
            nextConnections = await savePersistedConnections(legacyConnections);
            if (cancelled) return;
            clearLegacyConnections();
          } catch {
            nextConnections = legacyConnections;
          }
        }

        applyConfirmedConnections(nextConnections);
        hydratedRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        applyConfirmedConnections(DEFAULT_PERSISTED_CONNECTIONS);
        hydratedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setSavedConnections: Dispatch<SetStateAction<SavedConnection[]>> = (value) => {
    setSavedConnectionsState((current) => {
      const next =
        typeof value === "function" ? (value as (prevState: SavedConnection[]) => SavedConnection[])(current) : value;
      const payload = {
        savedConnections: next,
        selectedConnectionId: latestRef.current.selectedConnectionId,
      };
      persistNext(payload);
      return next;
    });
  };

  const setSelectedConnectionId: Dispatch<SetStateAction<string | null>> = (value) => {
    setSelectedConnectionIdState((current) => {
      const next = typeof value === "function" ? (value as (prevState: string | null) => string | null)(current) : value;
      const payload = {
        savedConnections: latestRef.current.savedConnections,
        selectedConnectionId: next,
      };
      persistNext(payload);
      return next;
    });
  };

  return { savedConnections, setSavedConnections, selectedConnectionId, setSelectedConnectionId };
}
