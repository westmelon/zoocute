import { render, screen } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EditorPanel } from "./components/editor-panel";
import { nodeDetailsByPath } from "./lib/mock-data";

const jsonNode = nodeDetailsByPath["/configs/payment/switches"];
const textNode = nodeDetailsByPath["/services/gateway"];
const binaryNode = nodeDetailsByPath["/services/session_blob"];

const defaultProps = {
  isEditing: false,
  onEnterEdit: vi.fn(),
  onExitEdit: vi.fn(),
  onDraftChange: vi.fn(),
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onFetchServerValue: vi.fn().mockResolvedValue(null),
  saveError: null,
  draft: undefined,
};

// Wrapper that provides stateful draft + editing management for EditorPanel
function StatefulEditor({ path }: { path: string }) {
  const node = nodeDetailsByPath[path];
  const [draft, setDraft] = React.useState<string | undefined>(undefined);
  const [isEditing, setIsEditing] = React.useState(false);
  return (
    <EditorPanel
      key={path}
      node={node}
      draft={draft}
      saveError={null}
      isEditing={isEditing}
      onEnterEdit={() => setIsEditing(true)}
      onExitEdit={() => setIsEditing(false)}
      onDraftChange={setDraft}
      onSave={vi.fn()}
      onDiscard={() => setDraft(undefined)}
      onFetchServerValue={vi.fn().mockResolvedValue("server value")}
    />
  );
}

function renderEditor(
  path: string,
  opts: { draft?: string; isEditing?: boolean } = {}
) {
  const node = nodeDetailsByPath[path];
  const onDraftChange = vi.fn();
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const onFetchServerValue = vi.fn().mockResolvedValue("server value");
  render(
    <EditorPanel
      key={path}
      node={node}
      draft={opts.draft}
      saveError={null}
      isEditing={opts.isEditing ?? false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
      onDraftChange={onDraftChange}
      onSave={onSave}
      onDiscard={onDiscard}
      onFetchServerValue={onFetchServerValue}
    />
  );
  return { onDraftChange, onSave, onDiscard, onFetchServerValue };
}

// ── Badge / header tests ───────────────────────────────────────────────────────

it("binary node shows read-only mode pill", () => {
  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
    />
  );
  expect(screen.getByText(binaryNode.displayModeLabel)).toBeInTheDocument();
});

it("JSON node shows editable mode pill", () => {
  renderEditor("/configs/payment/switches");
  expect(screen.getByText(jsonNode.displayModeLabel)).toBeInTheDocument();
});

// ── Toolbar action buttons only show in edit mode ─────────────────────────────

it("save button is not shown when not editing", () => {
  renderEditor("/configs/payment/switches");
  expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
});

it("save button is shown when isEditing=true", () => {
  renderEditor("/configs/payment/switches", { isEditing: true });
  expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
});

it("save button is disabled when there is no draft (no dirty changes)", () => {
  renderEditor("/configs/payment/switches", { isEditing: true });
  const saveBtn = screen.getByRole("button", { name: "保存" });
  expect(saveBtn).toBeDisabled();
});

it("save button is enabled when draft differs from node value", () => {
  renderEditor("/configs/payment/switches", {
    isEditing: true,
    draft: "new value",
  });
  const saveBtn = screen.getByRole("button", { name: "保存" });
  expect(saveBtn).not.toBeDisabled();
});

// ── Dirty / unsaved state ─────────────────────────────────────────────────────

it("editing a JSON node marks it as dirty (unsaved badge)", async () => {
  const user = userEvent.setup();
  render(<StatefulEditor path="/configs/payment/switches" />);

  // Enter edit mode first
  const editToggle = screen.getByRole("button", { name: "开启编辑" });
  await user.click(editToggle);

  const textarea = screen.getByRole("textbox", { name: "节点内容" });
  await user.clear(textarea);
  await user.type(textarea, "edited content");

  expect(screen.getByText("未保存")).toBeInTheDocument();
});

it("unsaved badge not shown when no draft changes", () => {
  renderEditor("/configs/payment/switches");
  expect(screen.queryByText("未保存")).not.toBeInTheDocument();
});

// ── Diff panel ────────────────────────────────────────────────────────────────

it("diff panel shows before/after content when '查看 Diff' is clicked", async () => {
  const user = userEvent.setup();
  renderEditor("/configs/payment/switches", {
    isEditing: true,
    draft: "new content here",
  });

  await user.click(screen.getByRole("button", { name: "查看 Diff" }));

  expect(screen.getByText("原始内容")).toBeInTheDocument();
  expect(screen.getByText("当前草稿")).toBeInTheDocument();
});

it("diff panel is not shown by default", () => {
  renderEditor("/configs/payment/switches");

  expect(screen.queryByText("原始内容")).not.toBeInTheDocument();
  expect(screen.queryByText("当前草稿")).not.toBeInTheDocument();
});

// ── Discard confirm dialog ────────────────────────────────────────────────────

it("discard button shows confirm dialog when there are dirty changes", async () => {
  const user = userEvent.setup();
  renderEditor("/configs/payment/switches", {
    isEditing: true,
    draft: "modified",
  });

  await user.click(screen.getByRole("button", { name: "放弃修改" }));

  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(screen.getByText("有未保存的修改，确定要放弃吗？")).toBeInTheDocument();
});

// ── Nav confirm dialog ────────────────────────────────────────────────────────

it("shows nav confirm dialog when pendingNavPath is set", () => {
  render(
    <EditorPanel
      {...defaultProps}
      node={textNode}
      pendingNavPath="/services"
    />
  );
  expect(screen.getByText("切换节点")).toBeInTheDocument();
  expect(screen.getByText("当前节点有未保存的修改，确定要放弃吗？")).toBeInTheDocument();
});

it("calls onConfirmNavAndDiscard when confirm clicked", async () => {
  const user = userEvent.setup();
  const onConfirmNavAndDiscard = vi.fn();
  render(
    <EditorPanel
      {...defaultProps}
      node={textNode}
      pendingNavPath="/services"
      onConfirmNavAndDiscard={onConfirmNavAndDiscard}
    />
  );
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onConfirmNavAndDiscard).toHaveBeenCalledOnce();
});

it("calls onCancelPendingNav when cancel clicked", async () => {
  const user = userEvent.setup();
  const onCancelPendingNav = vi.fn();
  render(
    <EditorPanel
      {...defaultProps}
      node={textNode}
      pendingNavPath="/services"
      onCancelPendingNav={onCancelPendingNav}
    />
  );
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(onCancelPendingNav).toHaveBeenCalledOnce();
});
