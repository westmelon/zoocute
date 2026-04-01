import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NodeHeader } from "./node-header";
import type { NodeDetails } from "../lib/types";

function makeNode(overrides: Partial<NodeDetails> = {}): NodeDetails {
  return {
    path: "/foo/bar",
    value: "hello",
    dataKind: "text",
    displayModeLabel: "文本 / 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 1,
    childrenCount: 0,
    updatedAt: "",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    dataLength: 5,
    ephemeral: false,
    ...overrides,
  };
}

it("shows path and mode pill", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      isReadOnly={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );

  expect(screen.getByText("/foo/bar")).toBeInTheDocument();
  expect(screen.getByText("文本 / 可编辑")).toBeInTheDocument();
});

it("calls onEnterEdit when toggle clicked in editable mode", async () => {
  const user = userEvent.setup();
  const onEnterEdit = vi.fn();

  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      isReadOnly={false}
      onEnterEdit={onEnterEdit}
      onExitEdit={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(onEnterEdit).toHaveBeenCalledOnce();
});

it("disables edit toggle when readonly", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      isReadOnly={true}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "开启编辑" })).toBeDisabled();
});

it("shows warning dialog for cautious nodes", async () => {
  const user = userEvent.setup();

  render(
    <NodeHeader
      node={makeNode({ dataKind: "cautious", displayModeLabel: "谨慎 / 可编辑" })}
      isEditing={false}
      isDirty={false}
      isReadOnly={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(screen.getByText(/可能改变原始格式/)).toBeInTheDocument();
});
