import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BrowserPane } from "./components/browser-pane";
import { tree } from "./lib/mock-data";

const defaultProps = {
  treeNodes: tree,
  activePath: "/configs/payment/switches",
  expandedPaths: new Set(["/"]),
  loadingPaths: new Set<string>(),
  connectionString: "127.0.0.1:2181",
  isConnected: false,
  onSelectPath: vi.fn(),
  onTogglePath: vi.fn(),
  onContextMenu: vi.fn(),
  searchQuery: "",
  onSearchQueryChange: vi.fn(),
  searchResults: [],
  searchMode: "tree" as const,
  onLocate: vi.fn(),
  isIndexing: false,
};

describe("BrowserPane", () => {
  it("renders search input", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.getByPlaceholderText("搜索节点...")).toBeInTheDocument();
  });

  it("renders connection badge", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.getByText("127.0.0.1:2181")).toBeInTheDocument();
  });

  it("does NOT render 收藏 or 最近访问 sections", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.queryByText("收藏")).not.toBeInTheDocument();
    expect(screen.queryByText("最近访问")).not.toBeInTheDocument();
  });

  it("calls onContextMenu when a node is right-clicked", () => {
    render(<BrowserPane {...defaultProps} />);
    const node = screen.getAllByRole("button")[0];
    fireEvent.contextMenu(node);
    expect(defaultProps.onContextMenu).toHaveBeenCalled();
  });
});
