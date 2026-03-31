import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";
import type { SavedConnection } from "./lib/types";

const connections: SavedConnection[] = [
  { id: "1", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
  { id: "2", name: "测试环境", connectionString: "test-zk:2181", timeoutMs: 5000 },
];

describe("ConnectionPane", () => {
  const baseProps = {
    connections,
    selectedId: null,
    connectedIds: new Set<string>(),
    isConnecting: false,
    pendingConnectionId: null,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDelete: vi.fn(),
  };

  it("renders connection cards", () => {
    render(<ConnectionPane {...baseProps} />);
    expect(screen.getByText("本地开发")).toBeInTheDocument();
    expect(screen.getByText("测试环境")).toBeInTheDocument();
  });

  it("highlights selected connection", () => {
    const { container } = render(<ConnectionPane {...baseProps} selectedId="1" />);
    const selected = container.querySelector(".conn-card.selected");
    expect(selected).not.toBeNull();
    expect(selected?.textContent).toContain("本地开发");
  });

  it("always shows connection status icons for every row", () => {
    const { container } = render(<ConnectionPane {...baseProps} />);
    expect(container.querySelectorAll(".conn-server-icon")).toHaveLength(connections.length);
  });

  it("shows delete action only for disconnected rows", () => {
    render(<ConnectionPane {...baseProps} connectedIds={new Set(["1"])} />);
    expect(screen.queryByLabelText("删除 本地开发")).not.toBeInTheDocument();
    expect(screen.getByLabelText("删除 测试环境")).toBeInTheDocument();
  });

  it("renders status and action icons with the shared connection icon treatment", () => {
    const { container } = render(
      <ConnectionPane {...baseProps} connectedIds={new Set(["1"])} />
    );
    expect(container.querySelectorAll(".conn-server-icon svg")).toHaveLength(connections.length);
    expect(container.querySelectorAll(".conn-icon-btn svg")).toHaveLength(3);
  });

  it("uses custom tooltip attributes instead of native title tooltips", () => {
    render(<ConnectionPane {...baseProps} connectedIds={new Set(["1"])} />);

    const disconnect = screen.getByLabelText("断开 本地开发");
    const remove = screen.getByLabelText("删除 测试环境");

    expect(disconnect).not.toHaveAttribute("title");
    expect(remove).not.toHaveAttribute("title");
    expect(disconnect).toHaveAttribute("aria-label", "断开 本地开发");
    expect(remove).toHaveAttribute("aria-label", "删除 测试环境");
  });

  it("shows a floating tooltip after a short hover delay", async () => {
    vi.useFakeTimers();
    render(<ConnectionPane {...baseProps} connectedIds={new Set(["1"])} />);

    const disconnect = screen.getByLabelText("断开 本地开发");
    fireEvent.mouseEnter(disconnect);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("断开 本地开发");
    vi.useRealTimers();
  });

  it("calls onNew when + 新建 is clicked", () => {
    const onNew = vi.fn();
    render(<ConnectionPane {...baseProps} connections={[]} onNew={onNew} />);
    fireEvent.click(screen.getByText("+ 新建"));
    expect(onNew).toHaveBeenCalled();
  });

  it("shows non-active connected rows as connected and disconnects them", async () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const user = userEvent.setup();

    render(
      <ConnectionPane
        {...baseProps}
        selectedId="1"
        connectedIds={new Set(["1", "2"])}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    );

    expect(screen.queryByLabelText("删除 测试环境")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("断开 测试环境"));

    expect(onDisconnect).toHaveBeenCalledWith("2");
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("shows a waiting state for the pending connection row", () => {
    render(
      <ConnectionPane
        {...baseProps}
        isConnecting={true}
        pendingConnectionId="1"
      />
    );

    expect(screen.getByLabelText("连接中 本地开发")).toBeDisabled();
    expect(document.querySelector(".conn-spinner")).not.toBeNull();
  });

  it("auto-hides a floating tooltip after it is shown", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <ConnectionPane {...baseProps} connectedIds={new Set(["1"])} />
    );

    const actionButton = container.querySelector(".conn-card-actions .conn-icon-btn");
    expect(actionButton).not.toBeNull();

    fireEvent.mouseEnter(actionButton as Element);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1800);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("ConnectionDetail", () => {
  it("validates connectionString is required", async () => {
    render(
      <ConnectionDetail
        connection={{ id: "new", name: "", connectionString: "", timeoutMs: 5000 }}
        isConnecting={false}
        isTesting={false}
        onSave={vi.fn()}
        onTestConnect={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("测试连接"));
    expect(await screen.findByText("连接地址不能为空")).toBeInTheDocument();
  });

  it("shows testing state and disables actions while waiting", () => {
    render(
      <ConnectionDetail
        connection={connections[0]}
        isConnecting={true}
        isTesting={true}
        onSave={vi.fn()}
        onTestConnect={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在测试连接，请稍候...");
    expect(screen.getByText("测试中...")).toBeDisabled();
    expect(screen.getByText("保存")).toBeDisabled();
    expect(screen.getByLabelText("连接地址")).toBeDisabled();
  });
});
