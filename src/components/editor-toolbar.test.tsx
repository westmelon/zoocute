import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EditorToolbar } from "./editor-toolbar";
import type { ViewMode, Charset } from "../lib/types";

const defaultProps = {
  isEditing: false,
  isDirty: false,
  viewMode: "raw" as ViewMode,
  onViewModeChange: vi.fn(),
  charset: "UTF-8" as Charset,
  onCharsetChange: vi.fn(),
  isTextNode: true,
  onDiff: vi.fn(),
  onDiscard: vi.fn(),
  onSave: vi.fn(),
};

it("shows view mode tabs always", () => {
  render(<EditorToolbar {...defaultProps} />);
  expect(screen.getByRole("button", { name: "RAW" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "XML" })).toBeInTheDocument();
});

it("renders view mode controls as a segmented group with a pressed active option", () => {
  render(<EditorToolbar {...defaultProps} viewMode="json" />);

  const group = screen.getByRole("group", { name: "查看模式" });
  expect(group).toHaveClass("toolbar-view-tabs");
  expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "RAW" })).toHaveAttribute("aria-pressed", "false");
});

it("renders compact dividers between view mode options", () => {
  const { container } = render(<EditorToolbar {...defaultProps} />);
  expect(container.querySelectorAll(".toolbar-view-divider")).toHaveLength(2);
});

it("hides action buttons in view mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={false} />);
  expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看 Diff" })).not.toBeInTheDocument();
});

it("shows action buttons in edit mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "放弃修改" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 Diff" })).toBeInTheDocument();
});

it("disables save and diff when no draft in edit mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看 Diff" })).toBeDisabled();
});

it("enables save and diff when has draft", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={true} />);
  expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "查看 Diff" })).not.toBeDisabled();
});

it("shows charset selector for text nodes", () => {
  render(<EditorToolbar {...defaultProps} isTextNode={true} />);
  expect(screen.getByLabelText("字符编码")).toBeInTheDocument();
});

it("hides charset selector for binary nodes", () => {
  render(<EditorToolbar {...defaultProps} isTextNode={false} />);
  expect(screen.queryByLabelText("字符编码")).not.toBeInTheDocument();
});

it("shows parser plugin selector and parse action", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      isTextNode={false}
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={false}
      isPluginParsing={false}
    />
  );

  expect(screen.getByLabelText("Plugin")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Parse" })).toBeInTheDocument();
});

it("calls plugin selection and parse callbacks", async () => {
  const user = userEvent.setup();
  const onPluginChange = vi.fn();
  const onParsePlugin = vi.fn();

  render(
    <EditorToolbar
      {...defaultProps}
      isTextNode={false}
      plugins={[
        { id: "dubbo-provider", name: "Dubbo Provider Decoder" },
        { id: "kafka-message", name: "Kafka Message Decoder" },
      ]}
      selectedPluginId="dubbo-provider"
      onPluginChange={onPluginChange}
      onParsePlugin={onParsePlugin}
      pluginResultAvailable={false}
      isPluginParsing={false}
    />
  );

  await user.selectOptions(screen.getByLabelText("Plugin"), "kafka-message");
  await user.click(screen.getByRole("button", { name: "Parse" }));

  expect(onPluginChange).toHaveBeenCalledWith("kafka-message");
  expect(onParsePlugin).toHaveBeenCalledOnce();
});

it("hides parser plugin controls for text nodes even when plugins are available", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      isTextNode={true}
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={false}
      isPluginParsing={false}
    />
  );

  expect(screen.queryByLabelText("Plugin")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Parse" })).not.toBeInTheDocument();
});

it("shows plugin tab only after a parse result exists", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      viewMode="plugin"
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={true}
      isPluginParsing={false}
    />
  );

  expect(screen.getByRole("button", { name: "PLUGIN" })).toBeInTheDocument();
});

it("hides plugin tab before a parse result exists", () => {
  render(
    <EditorToolbar
      {...defaultProps}
      plugins={[{ id: "dubbo-provider", name: "Dubbo Provider Decoder" }]}
      selectedPluginId="dubbo-provider"
      onPluginChange={vi.fn()}
      onParsePlugin={vi.fn()}
      pluginResultAvailable={false}
      isPluginParsing={false}
    />
  );

  expect(screen.queryByRole("button", { name: "PLUGIN" })).not.toBeInTheDocument();
});

it("calls onViewModeChange when tab clicked", async () => {
  const user = userEvent.setup();
  const onViewModeChange = vi.fn();
  render(<EditorToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);
  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(onViewModeChange).toHaveBeenCalledWith("json");
});

it("disables view mode switching while editing", async () => {
  const user = userEvent.setup();
  const onViewModeChange = vi.fn();
  render(
    <EditorToolbar
      {...defaultProps}
      isEditing={true}
      isDirty={true}
      onViewModeChange={onViewModeChange}
    />
  );

  const jsonButton = screen.getByRole("button", { name: "JSON" });
  expect(jsonButton).toBeDisabled();

  await user.click(jsonButton);
  expect(onViewModeChange).not.toHaveBeenCalled();
});

it("calls onSave when save button clicked", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={true} onSave={onSave} />);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(onSave).toHaveBeenCalledOnce();
});

it("calls onDiscard when discard button clicked", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} onDiscard={onDiscard} />);
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onDiscard).toHaveBeenCalledOnce();
});
