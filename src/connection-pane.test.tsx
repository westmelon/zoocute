import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";
import type { SavedConnection } from "./lib/types";

const connections: SavedConnection[] = [
  { id: "1", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
  { id: "2", name: "测试环境", connectionString: "test-zk:2181", timeoutMs: 5000 },
];

describe("ConnectionPane", () => {
  const baseProps = { connections, selectedId: null, connectedId: null, onSelect: vi.fn(), onNew: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn() };

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

  it("calls onNew when + 新建 is clicked", () => {
    const onNew = vi.fn();
    render(<ConnectionPane {...baseProps} connections={[]} onNew={onNew} />);
    fireEvent.click(screen.getByText("+ 新建"));
    expect(onNew).toHaveBeenCalled();
  });
});

describe("ConnectionDetail", () => {
  it("validates connectionString is required", async () => {
    render(
      <ConnectionDetail
        connection={{ id: "new", name: "", connectionString: "", timeoutMs: 5000 }}
        isConnected={false}
        onSave={vi.fn()}
        onTestConnect={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("测试连接"));
    expect(await screen.findByText("连接地址不能为空")).toBeInTheDocument();
  });
});
