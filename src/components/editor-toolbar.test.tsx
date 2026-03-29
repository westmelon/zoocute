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
  expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "XML" })).toBeInTheDocument();
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

it("calls onViewModeChange when tab clicked", async () => {
  const user = userEvent.setup();
  const onViewModeChange = vi.fn();
  render(<EditorToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);
  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(onViewModeChange).toHaveBeenCalledWith("json");
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
