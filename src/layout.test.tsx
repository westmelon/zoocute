import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Ribbon } from "./components/ribbon";
import { usePanelResize } from "./hooks/use-panel-resize";

describe("Ribbon", () => {
  it("renders browse, connections, log buttons", () => {
    render(<Ribbon mode="browse" onModeChange={() => {}} hasActiveSessions={true} />);
    expect(screen.getByTitle("节点树")).toBeInTheDocument();
    expect(screen.getByTitle("连接管理")).toBeInTheDocument();
    expect(screen.getByTitle("操作日志")).toBeInTheDocument();
  });

  it("marks active mode with active class", () => {
    render(<Ribbon mode="connections" onModeChange={() => {}} hasActiveSessions={true} />);
    expect(screen.getByTitle("连接管理").closest(".ribbon-btn")).toHaveClass("active");
    expect(screen.getByTitle("节点树").closest(".ribbon-btn")).not.toHaveClass("active");
  });

  it("calls onModeChange when a button is clicked", () => {
    const handler = vi.fn();
    render(<Ribbon mode="browse" onModeChange={handler} hasActiveSessions={true} />);
    fireEvent.click(screen.getByTitle("连接管理").closest(".ribbon-btn")!);
    expect(handler).toHaveBeenCalledWith("connections");
  });
});

describe("usePanelResize", () => {
  it("returns defaultWidth initially", () => {
    const { result } = renderHook(() => usePanelResize(220, "test-key"));
    expect(result.current.width).toBe(220);
  });

  it("clamps width between min and max", () => {
    const { result } = renderHook(() => usePanelResize(220, "test-key2", 160, 400));
    act(() => result.current.setWidth(50));
    expect(result.current.width).toBe(160);
    act(() => result.current.setWidth(999));
    expect(result.current.width).toBe(400);
  });
});
