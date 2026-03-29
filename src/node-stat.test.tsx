import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NodeStat } from "./components/node-stat";
import { nodeDetailsByPath } from "./lib/mock-data";

const node = nodeDetailsByPath["/configs/payment/switches"];

describe("NodeStat", () => {
  it("renders all 10 stat fields", () => {
    render(<NodeStat node={node} />);
    expect(screen.getByText("dataVersion")).toBeInTheDocument();
    expect(screen.getByText("cVersion")).toBeInTheDocument();
    expect(screen.getByText("aclVersion")).toBeInTheDocument();
    expect(screen.getByText("numChildren")).toBeInTheDocument();
    expect(screen.getByText("dataLength")).toBeInTheDocument();
    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    expect(screen.getByText("mZxid")).toBeInTheDocument();
    expect(screen.getByText("cZxid")).toBeInTheDocument();
    expect(screen.getByText("mtime")).toBeInTheDocument();
    expect(screen.getByText("ctime")).toBeInTheDocument();
  });

  it("renders zxid values with accent class", () => {
    const { container } = render(<NodeStat node={node} />);
    const zxidVals = container.querySelectorAll(".stat-val--zxid");
    expect(zxidVals.length).toBeGreaterThanOrEqual(2);
  });

  it("shows 否 for non-ephemeral nodes", () => {
    render(<NodeStat node={{ ...node, ephemeral: false }} />);
    expect(screen.getByText("否")).toBeInTheDocument();
  });

  it("shows 是 for ephemeral nodes", () => {
    render(<NodeStat node={{ ...node, ephemeral: true }} />);
    expect(screen.getByText("是")).toBeInTheDocument();
  });
});
