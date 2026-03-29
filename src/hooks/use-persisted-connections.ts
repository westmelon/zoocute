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
