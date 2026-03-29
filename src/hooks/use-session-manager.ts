import { useState } from "react";
import type { ActiveSession, NodeTreeItem, SavedConnection } from "../lib/types";

export function useSessionManager() {
  const [sessions, setSessions] = useState<Map<string, ActiveSession>>(
    () => new Map()
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  function addSession(connection: SavedConnection, rootNodes: NodeTreeItem[]) {
    const session: ActiveSession = {
      connection,
      treeNodes: rootNodes,
      expandedPaths: new Set(),
      loadingPaths: new Set(),
      activePath: null,
      activeNode: null,
      drafts: {},
      editingPaths: new Set(),
    };
    setSessions((prev) => new Map(prev).set(connection.id, session));
    setActiveTabId(connection.id);
  }

  function removeSession(connectionId: string) {
    setSessions((prev) => {
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
    setActiveTabId((prev) => {
      if (prev !== connectionId) return prev;
      const remaining = [...sessions.keys()].filter((k) => k !== connectionId);
      return remaining[0] ?? null;
    });
  }

  function updateSession(
    connectionId: string,
    updater: (s: ActiveSession) => ActiveSession
  ) {
    setSessions((prev) => {
      const session = prev.get(connectionId);
      if (!session) return prev;
      const next = new Map(prev);
      next.set(connectionId, updater(session));
      return next;
    });
  }

  function enterEditMode(connectionId: string, path: string) {
    updateSession(connectionId, (s) => ({
      ...s,
      editingPaths: new Set(s.editingPaths).add(path),
    }));
  }

  function exitEditMode(connectionId: string, path: string) {
    updateSession(connectionId, (s) => {
      const next = new Set(s.editingPaths);
      next.delete(path);
      return { ...s, editingPaths: next };
    });
  }

  const activeSession = activeTabId ? (sessions.get(activeTabId) ?? null) : null;
  const hasActiveSessions = sessions.size > 0;

  return {
    sessions,
    activeTabId,
    setActiveTabId,
    activeSession,
    hasActiveSessions,
    addSession,
    removeSession,
    updateSession,
    enterEditMode,
    exitEditMode,
  };
}
