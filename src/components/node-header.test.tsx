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
    displayModeLabel: "文本 · 可编辑",
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
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByText("/foo/bar")).toBeInTheDocument();
  expect(screen.getByText("文本 · 可编辑")).toBeInTheDocument();
});

it("wraps long paths without moving action controls into the text flow", () => {
  const longPath =
    "/very/long/path/that/should/wrap/inside/the/header/without/pushing/the/mode/pill/or/edit/button/offscreen";
  const { container } = render(
    <NodeHeader
      node={makeNode({ path: longPath })}
      isEditing={false}
      isDirty={true}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );

  expect(screen.getByText(longPath)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开启编辑" })).toBeInTheDocument();
  expect(screen.getByText("文本 · 可编辑")).toBeInTheDocument();
  expect(screen.getByText("未保存")).toBeInTheDocument();
  expect(container.querySelector(".content-header-main")).not.toBeNull();
  expect(container.querySelector(".content-header-actions")).not.toBeNull();
});

it("shows edit toggle for editable nodes", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: "开启编辑" })).toBeInTheDocument();
});

it("does not show edit toggle for binary nodes", () => {
  render(
    <NodeHeader
      node={makeNode({ dataKind: "binary", editable: false, displayModeLabel: "二进制 · 只读" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.queryByRole("button", { name: "开启编辑" })).not.toBeInTheDocument();
});

it("calls onEnterEdit when toggle clicked in view mode", async () => {
  const user = userEvent.setup();
  const onEnterEdit = vi.fn();
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      onEnterEdit={onEnterEdit}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(onEnterEdit).toHaveBeenCalledOnce();
});

it("shows unsaved badge when isDirty", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={true}
      isDirty={true}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByText("未保存")).toBeInTheDocument();
});

it("does not show unsaved badge when not dirty", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={true}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.queryByText("未保存")).not.toBeInTheDocument();
});

it("shows warning dialog when cautious node toggle clicked", async () => {
  const user = userEvent.setup();
  render(
    <NodeHeader
      node={makeNode({ dataKind: "cautious", displayModeLabel: "谨慎 · 可编辑" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(screen.getByText(/可能改变原始格式/)).toBeInTheDocument();
});

it("calls onExitEdit when toggle clicked while editing", async () => {
  const user = userEvent.setup();
  const onExitEdit = vi.fn();
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={true}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={onExitEdit}
    />
  );
  await user.click(screen.getByRole("button", { name: "退出编辑" }));
  expect(onExitEdit).toHaveBeenCalledOnce();
});

it("calls onEnterEdit when cautious dialog confirm button clicked", async () => {
  const user = userEvent.setup();
  const onEnterEdit = vi.fn();
  render(
    <NodeHeader
      node={makeNode({ dataKind: "cautious", displayModeLabel: "谨慎 · 可编辑" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={onEnterEdit}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(onEnterEdit).toHaveBeenCalledOnce();
});

it("dismisses cautious warning when cancel button clicked", async () => {
  const user = userEvent.setup();
  const onEnterEdit = vi.fn();
  render(
    <NodeHeader
      node={makeNode({ dataKind: "cautious", displayModeLabel: "谨慎 · 可编辑" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={onEnterEdit}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByText(/可能改变原始格式/)).not.toBeInTheDocument();
  expect(onEnterEdit).not.toHaveBeenCalled();
});
