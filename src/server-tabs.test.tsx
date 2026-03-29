import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ServerTabs } from "./components/server-tabs";
import type { ActiveSession, SavedConnection } from "./lib/types";

function makeSession(id: string, name: string): [string, ActiveSession] {
  const conn: SavedConnection = { id, name, connectionString: `${id}:2181`, timeoutMs: 5000 };
  return [id, {
    connection: conn,
    treeNodes: [],
    expandedPaths: new Set(),
    loadingPaths: new Set(),
    activePath: null,
    activeNode: null,
    drafts: {},
    editingPaths: new Set(),
  }];
}

describe("ServerTabs", () => {
  const sessions = new Map([makeSession("c1", "本地开发"), makeSession("c2", "生产集群")]);

  it("renders a tab for each session", () => {
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={vi.fn()} />
    );
    expect(screen.getByText("本地开发")).toBeInTheDocument();
    expect(screen.getByText("生产集群")).toBeInTheDocument();
  });

  it("calls onTabSelect when a non-active tab is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={onSelect} onTabClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("生产集群"));
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("calls onTabClose when × is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={onClose} />
    );
    const closeButtons = screen.getAllByTitle("断开连接");
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledWith("c1");
  });

  it("applies active class to the active tab", () => {
    const { container } = render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={vi.fn()} />
    );
    const active = container.querySelector(".server-tab--active");
    expect(active?.textContent).toContain("本地开发");
  });
});
