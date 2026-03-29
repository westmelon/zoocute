import { useState, useCallback, useEffect } from "react";
import type { ZkLogEntry } from "../lib/types";
import { readZkLogs, clearZkLogs } from "../lib/commands";

export interface LogFilters {
  success: boolean | null;   // null = show all
  connectionId: string;
}

export function useLogState(active: boolean) {
  const [allEntries, setAllEntries] = useState<ZkLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LogFilters>({ success: null, connectionId: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await readZkLogs(200);
      setAllEntries(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearZkLogs();
      setAllEntries([]);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Fetch once when the log tab becomes active.
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  const entries = allEntries.filter((e) => {
    if (filters.success !== null && e.success !== filters.success) return false;
    if (filters.connectionId && !e.connectionId?.includes(filters.connectionId)) return false;
    return true;
  });

  return { entries, loading, error, filters, setFilters, refresh, clear };
}
