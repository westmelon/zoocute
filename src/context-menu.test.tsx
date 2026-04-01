import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TreeContextMenu } from "./components/tree-context-menu";

const baseProps = {
  path: "/configs/payment",
  x: 100,
  y: 100,
  hasChildren: true,
  isReadOnly: false,
  onClose: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onCopyPath: vi.fn(),
  onRefresh: vi.fn(),
};

describe("TreeContextMenu", () => {
  it("renders the available menu items", () => {
    render(<TreeContextMenu {...baseProps} />);
    expect(screen.getByText("创建子节点")).toBeInTheDocument();
    expect(screen.getByText("删除节点")).toBeInTheDocument();
    expect(screen.getByText("复制路径")).toBeInTheDocument();
    expect(screen.getByText("刷新")).toBeInTheDocument();
  });

  it("calls onCopyPath and onClose when copy is clicked", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.click(screen.getByText("复制路径"));
    expect(baseProps.onCopyPath).toHaveBeenCalledWith("/configs/payment");
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("shows warning text when delete is clicked for a node with children", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.click(screen.getByText("删除节点"));
    expect(screen.getByText("将递归删除所有子节点")).toBeInTheDocument();
  });

  it("closes on Escape key", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
