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

  it("does not render empty-state copy when an expanded node has no children", () => {
    render(
      <BrowserPane
        {...defaultProps}
        treeNodes={[{ path: "/empty", name: "empty", hasChildren: false, children: [] }]}
        expandedPaths={new Set(["/empty"])}
      />
    );

    expect(screen.queryByText("暂无子节点")).not.toBeInTheDocument();
  });

  it("uses skeleton rows instead of loading text while children are loading", () => {
    render(
      <BrowserPane
        {...defaultProps}
        treeNodes={[{ path: "/loading", name: "loading", hasChildren: true }]}
        expandedPaths={new Set(["/loading"])}
        loadingPaths={new Set(["/loading"])}
      />
    );

    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("tree-loading-skeleton")).toHaveLength(3);
  });

  it("renders root nodes inside a tree list container", () => {
    const { container } = render(<BrowserPane {...defaultProps} />);
    const treeRoot = container.querySelector(".tree-list");
    expect(treeRoot).not.toBeNull();
    expect(treeRoot?.querySelectorAll(":scope > li").length).toBeGreaterThan(0);
  });

  it("renders expand controls without text glyph jitter", () => {
    render(<BrowserPane {...defaultProps} />);
    const expandButton = screen.getByLabelText("展开 configs");
    expect(expandButton.textContent).toBe("");
    expect(expandButton.querySelector(".tree-expand-glyph")).not.toBeNull();
  });
});
