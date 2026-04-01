import { act, render, screen } from "@testing-library/react";
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
  connectionId: "conn-a",
  nodePath: "/services/session_blob",
  onListParserPlugins: vi.fn().mockResolvedValue([]),
  onRunParserPlugin: vi.fn().mockResolvedValue({
    pluginId: "",
    pluginName: "",
    content: "",
    generatedAt: 0,
  }),
  onPluginError: vi.fn(),
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
      connectionId="conn-a"
      nodePath={path}
      onListParserPlugins={vi.fn().mockResolvedValue([])}
      onRunParserPlugin={vi.fn().mockResolvedValue({
        pluginId: "",
        pluginName: "",
        content: "",
        generatedAt: 0,
      })}
      onPluginError={vi.fn()}
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
      connectionId="conn-a"
      nodePath={path}
      onListParserPlugins={vi.fn().mockResolvedValue([])}
      onRunParserPlugin={vi.fn().mockResolvedValue({
        pluginId: "",
        pluginName: "",
        content: "",
        generatedAt: 0,
      })}
      onPluginError={vi.fn()}
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

it("switches to plugin mode after a successful parse", async () => {
  const user = userEvent.setup();
  const listPlugins = vi.fn().mockResolvedValue([
    { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
  ]);
  const runPlugin = vi.fn().mockResolvedValue({
    pluginId: "dubbo-provider",
    pluginName: "Dubbo Provider Decoder",
    content: "decoded payload",
    generatedAt: 1,
  });

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={listPlugins}
      onRunParserPlugin={runPlugin}
      onPluginError={vi.fn()}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(await screen.findByRole("button", { name: "PLUGIN" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox")).toHaveValue("decoded payload");
});

it("keeps the current view when plugin parsing fails", async () => {
  const user = userEvent.setup();
  const onPluginError = vi.fn();

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
      ])}
      onRunParserPlugin={vi.fn().mockRejectedValue(new Error("exit code 7"))}
      onPluginError={onPluginError}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(screen.getByRole("button", { name: "RAW" })).toHaveAttribute("aria-pressed", "true");
  expect(onPluginError).toHaveBeenCalledWith("exit code 7");
  expect(screen.getByText("Plugin Error")).toBeInTheDocument();
  expect(screen.getByText("exit code 7")).toBeInTheDocument();
  expect(screen.queryByText("Exception in thread")).not.toBeInTheDocument();
});

it("shows string-based plugin errors returned by the invoke layer", async () => {
  const user = userEvent.setup();
  const onPluginError = vi.fn();

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
      ])}
      onRunParserPlugin={vi.fn().mockRejectedValue("plugin Dubbo Hessian Parser failed with exit code 1: ClassNotFoundException")}
      onPluginError={onPluginError}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(screen.getByText("Plugin Error")).toBeInTheDocument();
  expect(screen.getByText(/ClassNotFoundException/)).toBeInTheDocument();
  expect(onPluginError).toHaveBeenCalledWith(
    "plugin Dubbo Hessian Parser failed with exit code 1: ClassNotFoundException"
  );
});

it("shows full plugin errors in a details dialog", async () => {
  const user = userEvent.setup();
  const message = [
    "plugin Dubbo Hessian Parser failed with exit code 1: ERROR StatusLogger bad config",
    "Exception in thread \"main\" java.lang.IllegalStateException: broken",
    "at demo.Main.main(Main.java:16)",
  ].join("\n");

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
      ])}
      onRunParserPlugin={vi.fn().mockRejectedValue(message)}
      onPluginError={vi.fn()}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(screen.getByText("Plugin Error")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  expect(screen.queryByText(/Exception in thread/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "查看详情" }));

  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(screen.getByText(/Exception in thread/)).toBeInTheDocument();
  expect(screen.getByText(/Main.java:16/)).toBeInTheDocument();
});

it("resets plugin state when the node path changes", async () => {
  const user = userEvent.setup();
  const listPlugins = vi.fn().mockResolvedValue([
    { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
  ]);
  const runPlugin = vi.fn().mockResolvedValue({
    pluginId: "dubbo-provider",
    pluginName: "Dubbo Provider Decoder",
    content: "decoded payload",
    generatedAt: 1,
  });

  const { rerender } = render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={listPlugins}
      onRunParserPlugin={runPlugin}
      onPluginError={vi.fn()}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));
  expect(await screen.findByRole("button", { name: "PLUGIN" })).toHaveAttribute("aria-pressed", "true");

  await act(async () => {
    rerender(
      <EditorPanel
        {...defaultProps}
        node={nodeDetailsByPath["/services/gateway"]}
        connectionId="conn-a"
        nodePath="/services/gateway"
        onListParserPlugins={listPlugins}
        onRunParserPlugin={runPlugin}
        onPluginError={vi.fn()}
      />
    );
  });

  expect(screen.getByRole("button", { name: "RAW" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "PLUGIN" })).not.toBeInTheDocument();
});

it("clears plugin error after a successful parse retry", async () => {
  const user = userEvent.setup();
  const onPluginError = vi.fn();
  const runPlugin = vi
    .fn()
    .mockRejectedValueOnce(new Error("exit code 7"))
    .mockResolvedValueOnce({
      pluginId: "dubbo-provider",
      pluginName: "Dubbo Provider Decoder",
      content: "decoded payload",
      generatedAt: 1,
    });

  render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
      ])}
      onRunParserPlugin={runPlugin}
      onPluginError={onPluginError}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(screen.getByText("Plugin Error")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(await screen.findByRole("button", { name: "PLUGIN" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("Plugin Error")).not.toBeInTheDocument();
  expect(onPluginError).toHaveBeenCalledWith("exit code 7");
});

it("clears plugin error when the node path changes", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <EditorPanel
      {...defaultProps}
      node={binaryNode}
      connectionId="conn-a"
      nodePath="/services/session_blob"
      onListParserPlugins={vi.fn().mockResolvedValue([
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
      ])}
      onRunParserPlugin={vi.fn().mockRejectedValue(new Error("exit code 7"))}
      onPluginError={vi.fn()}
    />
  );

  expect(await screen.findByLabelText("Plugin")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Plugin"), "dubbo-provider");
  await user.click(screen.getByRole("button", { name: "Parse" }));
  expect(screen.getByText("Plugin Error")).toBeInTheDocument();

  await act(async () => {
    rerender(
      <EditorPanel
        {...defaultProps}
        node={nodeDetailsByPath["/services/gateway"]}
        connectionId="conn-a"
        nodePath="/services/gateway"
        onListParserPlugins={vi.fn().mockResolvedValue([])}
        onRunParserPlugin={vi.fn()}
        onPluginError={vi.fn()}
      />
    );
  });

  expect(screen.queryByText("Plugin Error")).not.toBeInTheDocument();
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
